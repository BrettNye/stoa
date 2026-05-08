export class StateCache {
  private states = new Map<string, unknown>();

  private key(source: string, wiki: string, id: string): string {
    return `${source}:${wiki}:${id}`;
  }

  get<T>(source: string, wiki: string, id: string): T | undefined {
    return this.states.get(this.key(source, wiki, id)) as T | undefined;
  }

  set<T>(source: string, wiki: string, id: string, state: T): void {
    this.states.set(this.key(source, wiki, id), state);
  }

  has(source: string, wiki: string, id: string): boolean {
    return this.states.has(this.key(source, wiki, id));
  }

  size(): number { return this.states.size; }
}
