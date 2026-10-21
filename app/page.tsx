const workflows = [
  {
    number: "01",
    title: "Minor ailment assessment",
    description:
      "Chat through an adult intake, explore Ontario's minor ailment scope, and prepare a summary for a pharmacist.",
    status: "Try the demo",
  },
  {
    number: "02",
    title: "Prescription verification",
    description:
      "Review typed prescriptions for required fields, recorded allergies, duplicate ingredients, and a small set of supported checks.",
    status: "Planned",
  },
];

const agents = [
  { number: "1", name: "Intake", task: "Organize details and ask about gaps" },
  { number: "2", name: "Assessment", task: "Apply the supported case pathways" },
  { number: "3", name: "Verification", task: "Run selected prescription checks" },
];

export default function Home() {
  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Pharmacy Assistant home">
          <span className="brand-mark" aria-hidden="true">Rx</span>
          <span>Pharmacy Assistant</span>
        </a>
        <nav className="top-nav" aria-label="Main navigation">
          <a href="/assessment">Patient assessment</a>
          <a href="/pharmacy">Pharmacy dashboard</a>
          <a href="#workflows">Workflows</a>
          <a href="#scope">Project scope</a>
          <span className="local-badge"><span className="status-dot" /> Local prototype</span>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">COMP 385 · CAPSTONE PROJECT</p>
          <h1>Make every review easier to follow.</h1>
          <p className="hero-description">
            A focused pharmacy workflow prototype for organizing minor ailment
            assessments and checking typed prescriptions against a small,
            documented set of rules.
          </p>
          <a className="primary-link" href="/assessment">
            Start a minor ailment assessment <span aria-hidden="true">→</span>
          </a>
          <p className="hero-footnote">Built for a local demonstration with fictional cases.</p>
        </div>

        <aside className="agent-panel" aria-label="Planned agent workflow">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">CASE REVIEW FLOW</p>
              <h2>Three focused agents</h2>
            </div>
            <span className="outline-badge">In planning</span>
          </div>
          <ol className="agent-list">
            {agents.map((agent, index) => (
              <li className="agent-row" key={agent.number}>
                <span className="agent-number">{agent.number}</span>
                <div className="agent-copy">
                  <strong>{agent.name}</strong>
                  <span>{agent.task}</span>
                </div>
                <span className="agent-state">{index === 2 ? "Next" : "Planned"}</span>
              </li>
            ))}
          </ol>
          <p className="panel-note">
            A pharmacist reviewer remains responsible for the final assessment and decision.
          </p>
        </aside>
      </section>

      <section className="notice" aria-label="Prototype safety notice">
        <span className="notice-icon" aria-hidden="true">i</span>
        <p>
          <strong>Educational prototype only.</strong> Guided screening is available; clinical accuracy has not been validated.
          Use fictional records only; this application is not for patient care, prescribing,
          dispensing, or pharmacy operations.
        </p>
      </section>

      <section className="section-block" id="workflows">
        <div className="section-heading">
          <div>
            <p className="eyebrow eyebrow-dark">THE FIRST VERSION</p>
            <h2>Two workflows, one case record.</h2>
          </div>
          <p className="section-intro">
            The initial scope stays small enough to build and evaluate within an eight-week capstone.
          </p>
        </div>
        <div className="workflow-grid">
          {workflows.map((workflow) => (
            <article className="workflow-card" key={workflow.number}>
              <div className="workflow-card-top">
                <span className="workflow-number">{workflow.number}</span>
                <span className="outline-badge">{workflow.status}</span>
              </div>
              <h3>{workflow.title}</h3>
              <p>{workflow.description}</p>
              {workflow.number === "01" ? <a className="card-footer" href="/assessment">Open assessment <span aria-hidden="true">↗</span></a> : <span className="card-footer">Fictional cases only <span aria-hidden="true">↗</span></span>}
            </article>
          ))}
        </div>
      </section>

      <section className="scope-strip" id="scope">
        <div>
          <p className="eyebrow eyebrow-dark">SUPPORTED SCOPE</p>
          <h2>Small by design.</h2>
        </div>
        <div className="scope-item">
          <span className="scope-label">ASSESSMENTS</span>
          <strong>Adults 18+</strong>
          <span>Ontario minor ailment intake</span>
        </div>
        <div className="scope-item">
          <span className="scope-label">PRESCRIPTIONS</span>
          <strong>Typed only</strong>
          <span>Up to 6 selected products</span>
        </div>
        <div className="scope-item">
          <span className="scope-label">DATA</span>
          <strong>100 synthetic cases</strong>
          <span>60 development · 40 final</span>
        </div>
      </section>

      <footer className="page-footer">
        <span>Pharmacy Assistant · COMP 385</span>
        <span>Local demo · synthetic data only</span>
      </footer>
    </main>
  );
}
