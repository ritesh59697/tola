import { PlanState } from "./hooks";
import type { SchemeData } from "./hooks";

/** One count, split between the project's own demo wallets and everyone else. */
export interface Split<T> {
  outside: T;
  demo: T;
}

export interface Usage {
  schemes: Split<number>;
  customers: Split<number>;
  plans: Split<number>;
  instalments: Split<number>;
  paidIn: Split<bigint>;
  delivered: Split<number>;
  refundedInDefault: Split<number>;
  decimals: number;
}

/**
 * Adds up activity from the plans the page already reads, with no extra requests.
 * A customer plan counts as outside when the customer's wallet is not one of the project's own.
 * A scheme counts as outside when its jeweller is not one of the project's own.
 */
export function summarizeUsage(schemes: SchemeData[], demoWallets: string[]): Usage {
  const demo = new Set(demoWallets.map((w) => w.toLowerCase()));
  const isDemo = (address: string) => demo.has(address.toLowerCase());
  const usage: Usage = {
    schemes: { outside: 0, demo: 0 },
    customers: { outside: 0, demo: 0 },
    plans: { outside: 0, demo: 0 },
    instalments: { outside: 0, demo: 0 },
    paidIn: { outside: 0n, demo: 0n },
    delivered: { outside: 0, demo: 0 },
    refundedInDefault: { outside: 0, demo: 0 },
    decimals: schemes[0]?.decimals ?? 0,
  };
  const customers = { outside: new Set<string>(), demo: new Set<string>() };

  for (const scheme of schemes) {
    usage.schemes[isDemo(scheme.jeweller) ? "demo" : "outside"] += 1;
    for (const plan of scheme.plans) {
      const side = isDemo(plan.customer) ? "demo" : "outside";
      customers[side].add(plan.customer.toLowerCase());
      usage.plans[side] += 1;
      usage.instalments[side] += plan.paidCount;
      // Every instalment in a scheme is the same amount, so this holds after a plan pays out too.
      usage.paidIn[side] += scheme.terms.instalment * BigInt(plan.paidCount);
      if (plan.state === PlanState.Collected) usage.delivered[side] += 1;
      if (plan.state === PlanState.ClaimedInDefault) usage.refundedInDefault[side] += 1;
    }
  }
  usage.customers = { outside: customers.outside.size, demo: customers.demo.size };
  return usage;
}
