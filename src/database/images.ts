/**
 * Product image storage.
 *
 * Images live under <userData>/images/, content-addressed by the SHA-256 of
 * the file bytes: `images/<sha256>.<ext>`. Identical bytes hash to the same
 * path, so deduplication is free. `products.image_path` stores the relative
 * reference; absolute paths never touch the database.
 *
 * Validation is by magic bytes, never by extension, and every byte buffer
 * crossing the trust boundary (renderer → main) is re-validated here.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database as DatabaseType } from 'better-sqlite3'

/** Hard cap: images larger than this are rejected with a plain-language error. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const IMAGES_DIR = 'images'

export type ImageKind = 'png' | 'jpg' | 'webp'

const MIME: Record<ImageKind, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

/** Reference format guard — also blocks path traversal (no `..`, no `/` beyond the dir). */
const REF_RE = /^images\/[0-9a-f]{64}\.(png|jpg|webp)$/

export function isValidImageRef(ref: string): boolean {
  return REF_RE.test(ref)
}

export function mimeFor(kind: ImageKind): string {
  return MIME[kind]
}

/**
 * Magic-byte detection. PNG: 89 50 4E 47 0D 0A 1A 0A. JPEG: FF D8 FF.
 * WebP: RIFF....WEBP. Anything else → null, no matter the filename.
 */
export function detectImageKind(bytes: Buffer): ImageKind | null {
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return 'png'
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg'
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

/** Validate raw bytes; throws plain-language errors naming the rule broken. */
export function validateImageBytes(bytes: Buffer): ImageKind {
  if (!bytes || bytes.length === 0) {
    throw new Error('The selected file is empty — no image was stored.')
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    const mb = (bytes.length / (1024 * 1024)).toFixed(1)
    throw new Error(
      `That image is ${mb} MB — the limit is 5 MB. Choose a smaller image or compress it first.`,
    )
  }
  const kind = detectImageKind(bytes)
  if (!kind) {
    throw new Error(
      'That file is not a supported image. Choose a PNG, JPG, or WebP file — ' +
        'renaming another file type does not make it an image.',
    )
  }
  return kind
}

/**
 * Hash, validate, and write the image under <baseDir>/images/. Returns the
 * relative reference for `products.image_path`. Idempotent: identical bytes
 * are never written twice.
 */
export function storeImage(baseDir: string, bytes: Buffer): string {
  const kind = validateImageBytes(bytes)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const ref = `${IMAGES_DIR}/${hash}.${kind}`
  const dir = join(baseDir, IMAGES_DIR)
  mkdirSync(dir, { recursive: true })
  const abs = join(dir, `${hash}.${kind}`)
  if (!existsSync(abs)) {
    writeFileSync(abs, bytes)
  }
  return ref
}

/** Resolve a stored reference to an absolute path; rejects malformed refs. */
export function resolveImagePath(baseDir: string, imageRef: string): string {
  if (!isValidImageRef(imageRef)) {
    throw new Error(`Invalid image reference "${imageRef}".`)
  }
  return join(baseDir, imageRef)
}

/** Read the bytes behind a reference; null when the file is gone. */
export function readImageBytes(baseDir: string, imageRef: string): Buffer | null {
  const abs = resolveImagePath(baseDir, imageRef)
  try {
    return readFileSync(abs)
  } catch {
    return null
  }
}

/** Delete the file behind a reference; missing files are not an error. */
export function deleteImageFile(baseDir: string, imageRef: string): void {
  const abs = resolveImagePath(baseDir, imageRef)
  try {
    unlinkSync(abs)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
  }
}

/** How many products currently link this image reference. */
export function countReferences(db: DatabaseType, imageRef: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM products WHERE image_path = ?')
    .get(imageRef) as { n: number }
  return row.n
}

/**
 * Delete the file behind `imageRef` when nothing references it anymore.
 * Call after a product's image was replaced, removed, or the product deleted.
 */
export function releaseUnreferenced(db: DatabaseType, baseDir: string, imageRef: string): void {
  if (!imageRef) return
  if (countReferences(db, imageRef) === 0) {
    deleteImageFile(baseDir, imageRef)
  }
}
