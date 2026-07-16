import { Agent, callable, routeAgentRequest } from "agents";

export interface CounterState {
  count: number;
}

export interface Env {
  CounterAgent: DurableObjectNamespace<CounterAgent>;
}

export class CounterAgent extends Agent<Env, CounterState> {
  initialState: CounterState = { count: 0 };

  @callable()
  increment(): number {
    const count = this.state.count + 1;
    this.setState({ count });
    return count;
  }

  @callable()
  decrement(): number {
    const count = this.state.count - 1;
    this.setState({ count });
    return count;
  }

  @callable()
  reset(): number {
    this.setState({ count: 0 });
    return 0;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routeAgentRequest(request, env)) ??
      Response.json({ error: "Agent not found" }, { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
