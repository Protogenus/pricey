import { migration001Initial } from './001_initial.js'
import { migration002Exchange } from './002_exchange.js'
import type { Migration } from '../migrations.js'

/** All migrations in dependency order. Append new ones here. */
export const allMigrations: Migration[] = [migration001Initial, migration002Exchange]
