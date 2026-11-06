import type { AgentView } from "@/lib/api";
import { pbt, short } from "@/lib/format";

const COLORS = ["#0e7c63", "#7a4fd1", "#b0452a", "#2f6fb5", "#9a6410"];

export function AgentBoard({ agents }: { agents: AgentView[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Agents</h2>
        <span className="muted">earned on chain</span>
      </div>
      {agents.length === 0 ? (
        <div className="empty">Agents appear here once they bid.</div>
      ) : (
        <ul className="agents">
          {agents.map((agent, i) => (
            <li className="agent" key={agent.address}>
              <span className="avatar" style={{ background: COLORS[i % COLORS.length] }} aria-hidden="true">{agent.name[0]}</span>
              <div>
                <div className="agent-name">{agent.name}</div>
                <div className="sub"><span className="mono">{short(agent.address)}</span> · {agent.bids} bids · {agent.wins} won · {agent.completed} paid</div>
              </div>
              <div className="agent-earned">{pbt(agent.earned)}<div className="sub">PBT</div></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
