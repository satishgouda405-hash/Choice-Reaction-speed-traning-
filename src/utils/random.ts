export class RandomEngine {
  private history: string[] = [];
  private maxHistory = 6;

  next(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next(min, max + 1));
  }

  pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  pickWeighted<T>(items: { item: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = Math.random() * total;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item.item;
    }
    return items[items.length - 1].item;
  }

  pickNoRepeat<T>(arr: T[], keyFn: (item: T) => string): T {
    const valid = arr.filter(a => !this.history.includes(keyFn(a)));
    const pool = valid.length > 0 ? valid : arr;
    const chosen = pool[this.nextInt(0, pool.length - 1)];
    this.history.push(keyFn(chosen));
    if (this.history.length > this.maxHistory) this.history.shift();
    return chosen;
  }

  shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  randomDelay(minMs: number, maxMs: number): number {
    return this.nextInt(minMs, maxMs);
  }
}
