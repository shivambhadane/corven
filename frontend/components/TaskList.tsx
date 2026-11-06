"use client";

import { useRouter } from "next/navigation";
import type { TaskView } from "@/lib/api";
import { pbt, short } from "@/lib/format";
import { StageBadge } from "./StageBadge";

export function TaskList({ tasks }: { tasks: TaskView[] }) {
  const router = useRouter();
  if (!tasks.length) {
    return <div className="empty">No jobs on chain yet. Post one to get the agents working.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th className="num">Bounty</th>
            <th className="hide-sm">Bids</th>
            <th>Winner</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.task_id} className="clickable" onClick={() => router.push(`/tasks/${task.task_id}`)} tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/tasks/${task.task_id}`)}>
              <td>
                <span className="job-title">{task.title ?? "Untitled job"}</span>
                <span className="sub mono">{short(task.task_id, 10, 6)}</span>
              </td>
              <td className="num mono">{pbt(task.bounty)}</td>
              <td className="mono hide-sm">{task.auction.bids.length}</td>
              <td>{task.auction.winner?.agent_name ?? <span className="muted">—</span>}</td>
              <td><StageBadge stage={task.stage} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
