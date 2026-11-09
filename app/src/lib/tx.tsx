import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Contract, Interface } from "ethers";
import type { InterfaceAbi, TransactionResponse } from "ethers";
import { settings } from "../config";
import { erc20Abi, registryAbi, schemeAbi } from "./abi";
import { duration } from "./format";
import { useWallet } from "./wallet";

export type TxPhase = "wallet" | "pending" | "confirmed" | "refused" | "failed";

export interface TxState {
  id: number;
  label: string;
  phase: TxPhase;
  hash?: string;
  message?: string;
}

const errorInterface = new Interface([...schemeAbi, ...registryAbi].filter((f) => f.startsWith("error")));

/** Turns a contract's refusal into a sentence a customer can read. */
function explainRefusal(name: string, args: readonly unknown[]): string {
  const now = () => Math.floor(Date.now() / 1000);
  const wait = (index: number) => duration(Number(args[index]) - now());
  switch (name) {
    case "CustomerHasNotConfirmed":
      return "The customer has not confirmed delivery, so this money cannot be taken.";
    case "BondBelowRequired":
      return "That would leave the bond below what this scheme requires.";
    case "NotJeweller":
      return "Only this scheme's jeweller can do that.";
    case "NotPlanCustomer":
      return "Only the customer who owns this plan can do that.";
    case "SchemeInDefault":
      return "This scheme is in default. Customers can now claim their money.";
    case "SchemeNotInDefault":
      return "This scheme is not in default.";
    case "SchemeUnderReview":
      return `This scheme is flagged as under-backed. The jeweller has ${wait(0)} left to repair it.`;
    case "StalePrice":
      return "The gold price from the oracle is too old to use. Please try again after its next update.";
    case "InvalidPrice":
      return "The gold price is not available right now.";
    case "PlanNotActive":
      return "This plan is already closed.";
    case "AllInstalmentsPaid":
      return "Every instalment on this plan has been paid.";
    case "InstalmentNotDue":
      return `The next instalment opens in ${wait(0)}.`;
    case "PlanLapsed":
      return "The time to pay this instalment has passed.";
    case "NotMatured":
      return `This plan matures in ${wait(0)}.`;
    case "DeliveryWindowOpen":
      return `The jeweller still has ${wait(0)} to deliver.`;
    case "BondCannotCoverGain":
      return "The bond cannot cover this payout. Flag the scheme to start the default process.";
    case "BondIsSufficient":
      return "The bond is sufficient, so the scheme cannot be flagged.";
    case "AlreadyFlagged":
      return "This scheme is already flagged.";
    case "NotFlagged":
      return "This scheme is not flagged.";
    case "CureWindowOpen":
      return `The jeweller still has ${wait(0)} to repair the bond.`;
    case "TallyIncomplete":
      return "Customers' gains still need to be added up first.";
    case "ClaimsOutstanding":
      return "Some customers have not claimed yet.";
    case "TermsOutsideLimits":
      return "These terms are outside the limits every scheme must respect.";
    case "ZeroAmount":
      return "Enter an amount above zero.";
    default:
      return `The contract refused this (${name}).`;
  }
}

function findRevertData(error: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (value: unknown): string | null => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.data === "string" && record.data.startsWith("0x") && record.data.length >= 10) return record.data;
    for (const key of ["error", "info", "data", "cause", "payload"]) {
      const found = walk(record[key]);
      if (found) return found;
    }
    return null;
  };
  return walk(error);
}

export function explainError(error: unknown): { refused: boolean; message: string } {
  const code = (error as { code?: unknown }).code;
  if (code === "ACTION_REJECTED" || code === 4001) return { refused: false, message: "Cancelled in your wallet." };
  const data = findRevertData(error);
  if (data) {
    try {
      const parsed = errorInterface.parseError(data);
      if (parsed) return { refused: true, message: explainRefusal(parsed.name, parsed.args) };
    } catch {
      // Not one of Tola's errors; fall through.
    }
  }
  const message = (error as { shortMessage?: string; message?: string }).shortMessage ?? (error as Error).message ?? "";
  if (/insufficient funds/i.test(message)) return { refused: false, message: "This wallet needs a little QIE to pay for gas." };
  if (/transfer amount exceeds|ERC20InsufficientBalance/i.test(message)) return { refused: true, message: "Not enough balance in this wallet." };
  return { refused: false, message: message.slice(0, 160) || "Something went wrong." };
}

interface TxContextValue {
  transactions: TxState[];
  dismiss: (id: number) => void;
  /** Runs a contract call through its whole life, showing each state. */
  run: (
    label: string,
    address: string,
    abi: InterfaceAbi,
    method: string,
    args?: unknown[],
    options?: { forceOnChain?: boolean; value?: bigint },
  ) => Promise<boolean>;
  approveThenRun: (
    token: string,
    spender: string,
    amount: bigint,
    label: string,
    address: string,
    abi: InterfaceAbi,
    method: string,
    args?: unknown[],
  ) => Promise<boolean>;
}

const TxContext = createContext<TxContextValue | null>(null);
let nextId = 1;

export function TxProvider({ children, onSettled }: { children: ReactNode; onSettled?: () => void }) {
  const { getSigner } = useWallet();
  const [transactions, setTransactions] = useState<TxState[]>([]);

  const update = useCallback((id: number, patch: Partial<TxState>) => {
    setTransactions((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const dismiss = useCallback((id: number) => {
    setTransactions((list) => list.filter((t) => t.id !== id));
  }, []);

  const run = useCallback<TxContextValue["run"]>(
    async (label, address, abi, method, args = [], options = {}) => {
      const id = nextId++;
      setTransactions((list) => [...list.slice(-2), { id, label, phase: "wallet" }]);
      let hash: string | undefined;
      try {
        const signer = await getSigner();
        const contract = new Contract(address, abi, signer);
        // forceOnChain skips the pre-flight check so a refusal lands on the chain for all to see.
        const overrides = {
          ...(options.forceOnChain ? { gasLimit: BigInt(settings.forcedRevertGasLimit) } : {}),
          ...(options.value !== undefined ? { value: options.value } : {}),
        };
        const response: TransactionResponse = await contract[method](...args, overrides);
        hash = response.hash;
        update(id, { phase: "pending", hash });
        const receipt = await response.wait();
        if (receipt?.status === 0) throw Object.assign(new Error("reverted"), { receipt });
        update(id, { phase: "confirmed" });
        setTimeout(() => dismiss(id), settings.txDismissMs);
        onSettled?.();
        return true;
      } catch (error) {
        if (hash) {
          // The transaction was mined and reverted. Replay it to learn why.
          let explanation = explainError(error);
          try {
            const signer = await getSigner();
            await new Contract(address, abi, signer)[method].staticCall(...args, options.value !== undefined ? { value: options.value } : {});
          } catch (replay) {
            explanation = explainError(replay);
          }
          update(id, { phase: "refused", hash, message: explanation.message });
        } else {
          const explanation = explainError(error);
          update(id, { phase: explanation.refused ? "refused" : "failed", message: explanation.message });
        }
        onSettled?.();
        return false;
      }
    },
    [getSigner, update, dismiss, onSettled],
  );

  const approveThenRun = useCallback<TxContextValue["approveThenRun"]>(
    async (tokenAddress, spender, amount, label, address, abi, method, args = []) => {
      const signer = await getSigner();
      const owner = await signer.getAddress();
      const allowance: bigint = await new Contract(tokenAddress, erc20Abi, signer).allowance(owner, spender);
      if (allowance < amount) {
        const approved = await run("Allow this payment", tokenAddress, erc20Abi, "approve", [spender, amount]);
        if (!approved) return false;
      }
      return run(label, address, abi, method, args);
    },
    [getSigner, run],
  );

  const value = useMemo(() => ({ transactions, dismiss, run, approveThenRun }), [transactions, dismiss, run, approveThenRun]);
  return <TxContext.Provider value={value}>{children}</TxContext.Provider>;
}

export function useTx() {
  const context = useContext(TxContext);
  if (!context) throw new Error("useTx outside TxProvider");
  return context;
}
