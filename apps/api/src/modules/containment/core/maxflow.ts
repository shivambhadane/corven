/**
 * Dinic's maximum flow on a directed multigraph, iterative (no recursion), with
 * arcs stored in insertion order so results are deterministic.
 */
export class FlowNetwork {
  private readonly head: number[];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly next: number[] = [];
  private level: number[] = [];
  private it: number[] = [];
  /** Original capacity of every arc (even indices are forward arcs). */
  private readonly origCap: number[] = [];

  constructor(readonly nodeCount: number) {
    this.head = new Array<number>(nodeCount).fill(-1);
  }

  /** Adds an arc u -> v. Returns its index; the reverse arc is index + 1. */
  addArc(u: number, v: number, capacity: number): number {
    const id = this.to.length;
    this.to.push(v, u);
    this.cap.push(capacity, 0);
    this.origCap.push(capacity, 0);
    this.next.push(this.head[u]!, this.head[v]!);
    this.head[u] = id;
    this.head[v] = id + 1;
    return id;
  }

  private bfs(s: number, t: number): boolean {
    this.level = new Array<number>(this.nodeCount).fill(-1);
    this.level[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const u = q[h]!;
      for (let a = this.head[u]!; a !== -1; a = this.next[a]!) {
        const v = this.to[a]!;
        if (this.cap[a]! > 0 && this.level[v] === -1) {
          this.level[v] = this.level[u]! + 1;
          q.push(v);
        }
      }
    }
    return this.level[t]! !== -1;
  }

  /** Max flow from s to t; stops early once `limit` is reached (used to detect "infinite"). */
  maxFlow(s: number, t: number, limit = Number.POSITIVE_INFINITY): number {
    let flow = 0;
    while (flow < limit && this.bfs(s, t)) {
      this.it = [...this.head];
      for (;;) {
        const pushed = this.augment(s, t, limit - flow);
        if (pushed === 0) break;
        flow += pushed;
        if (flow >= limit) break;
      }
    }
    return flow;
  }

  /** One augmenting path in the level graph, found iteratively. */
  private augment(s: number, t: number, limit: number): number {
    const path: number[] = []; // arc indices
    let u = s;
    for (;;) {
      if (u === t) {
        let f = limit;
        for (const a of path) f = Math.min(f, this.cap[a]!);
        for (const a of path) {
          this.cap[a]! -= f;
          this.cap[a ^ 1]! += f;
        }
        return f;
      }
      let advanced = false;
      for (; this.it[u]! !== -1; this.it[u] = this.next[this.it[u]!]!) {
        const a = this.it[u]!;
        const v = this.to[a]!;
        if (this.cap[a]! > 0 && this.level[v] === this.level[u]! + 1) {
          path.push(a);
          u = v;
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        if (path.length === 0) return 0;
        // dead end: retreat and skip the arc that led here
        const a = path.pop()!;
        u = this.to[a ^ 1]!;
        this.it[u] = this.next[this.it[u]!]!;
      }
    }
  }

  /** Nodes reachable from s through arcs with remaining capacity (the source side of the minimum cut with the smallest source side). */
  residualReachable(s: number): boolean[] {
    const seen = new Array<boolean>(this.nodeCount).fill(false);
    seen[s] = true;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const u = q[h]!;
      for (let a = this.head[u]!; a !== -1; a = this.next[a]!) {
        const v = this.to[a]!;
        if (this.cap[a]! > 0 && !seen[v]) {
          seen[v] = true;
          q.push(v);
        }
      }
    }
    return seen;
  }

  arcCount(): number {
    return this.to.length / 2;
  }
  arcFrom(id: number): number {
    return this.to[id + 1]!;
  }
  arcTo(id: number): number {
    return this.to[id]!;
  }
  originalCapacity(id: number): number {
    return this.origCap[id]!;
  }
}
