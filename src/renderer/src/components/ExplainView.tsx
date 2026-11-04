import type { ExplainStep } from '../../../engine/explain.js'

/** Numbered walkthrough of a calculation: formula, substituted values, result. */
export function ExplainView({ steps, title }: { steps: ExplainStep[]; title?: string }) {
  if (!steps || steps.length === 0) return null
  return (
    <div className="explain">
      {title ? <h3>{title}</h3> : null}
      <ol className="explain-steps">
        {steps.map((s, i) => (
          <li key={i} className="explain-step">
            <div className="explain-step-head">
              <span className="explain-num">{i + 1}</span>
              <strong>{s.title}</strong>
            </div>
            <div className="explain-formula">{s.formula}</div>
            <div className="explain-substituted">{s.substituted}</div>
            <div className="explain-result">{s.result}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}
