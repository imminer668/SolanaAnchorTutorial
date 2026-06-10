"use client";

import { useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PREDICTION_MARKET_PROGRAM_ID,
  deriveMarket,
  derivePosition,
  getPredictionMarketProgram,
} from "../lib/program";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };

type MarketView = {
  authority: string;
  marketId: string;
  quoteMint: string;
  question: string;
  endTime: string;
  totalA: string;
  totalB: string;
  resolved: string;
  winningOutcome: string;
};

function parsePubkey(value: string): PublicKey | null {
  try {
    return value ? new PublicKey(value) : null;
  } catch {
    return null;
  }
}

function nowSeconds(offset = 3600) {
  return Math.floor(Date.now() / 1000) + offset;
}

function outcomeLabel(outcome: string) {
  return outcome === "1" ? "Outcome A" : outcome === "2" ? "Outcome B" : "Unresolved";
}

export default function HomePage() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { connected, publicKey, sendTransaction } = useWallet();

  const [quoteMintInput, setQuoteMintInput] = useState("");
  const [marketId, setMarketId] = useState(String(Date.now()));
  const [question, setQuestion] = useState("Will SOL close higher this week?");
  const [endTime, setEndTime] = useState(String(nowSeconds(86400)));
  const [marketInput, setMarketInput] = useState("");
  const [betAmount, setBetAmount] = useState("10000000");
  const [betOutcome, setBetOutcome] = useState("1");
  const [resolveOutcome, setResolveOutcome] = useState("1");
  const [marketView, setMarketView] = useState<MarketView | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const quoteMint = useMemo(() => parsePubkey(quoteMintInput), [quoteMintInput]);

  const derived = useMemo(() => {
    if (!publicKey || !quoteMint || !marketId) return null;
    try {
      return deriveMarket(publicKey, quoteMint, marketId);
    } catch {
      return null;
    }
  }, [marketId, publicKey, quoteMint]);

  const activeMarket = useMemo(() => {
    return parsePubkey(marketInput) ?? derived?.market ?? null;
  }, [derived?.market, marketInput]);

  const position = useMemo(() => {
    if (!activeMarket || !publicKey) return null;
    return derivePosition(activeMarket, publicKey);
  }, [activeMarket, publicKey]);

  const userQuoteAta = useMemo(() => {
    if (!publicKey || !quoteMint) return null;
    return getAssociatedTokenAddressSync(quoteMint, publicKey);
  }, [publicKey, quoteMint]);

  const setError = (message: string) => setStatus({ kind: "error", message });

  const requireProgram = () => {
    if (!wallet || !publicKey) {
      setError("请先连接钱包");
      return null;
    }
    return getPredictionMarketProgram(connection, wallet);
  };

  const requireDerived = () => {
    if (!publicKey || !quoteMint || !marketId || !question) {
      setError("请填写有效 quote mint、market id 和 question");
      return null;
    }
    try {
      return deriveMarket(publicKey, quoteMint, marketId);
    } catch {
      setError("Market ID 必须是 u64 数字");
      return null;
    }
  };

  const refreshMarket = async () => {
    const program = requireProgram();
    if (!program || !activeMarket) return;
    setStatus({ kind: "loading", message: "Reading market..." });
    try {
      const account = await (program.account as any).market.fetch(activeMarket);
      setMarketView({
        authority: account.authority.toBase58(),
        marketId: account.marketId.toString(),
        quoteMint: account.quoteMint.toBase58(),
        question: account.question,
        endTime: account.endTime.toString(),
        totalA: account.totalA.toString(),
        totalB: account.totalB.toString(),
        resolved: account.resolved ? "true" : "false",
        winningOutcome: outcomeLabel(String(account.winningOutcome)),
      });
      setStatus({ kind: "success", message: "Market loaded" });
    } catch (err: any) {
      setMarketView(null);
      setStatus({ kind: "error", message: err?.message ?? "Read market failed" });
    }
  };

  const createAta = async () => {
    if (!publicKey || !quoteMint || !userQuoteAta) {
      setError("无法创建 ATA：quote mint 或钱包无效");
      return;
    }
    setStatus({ kind: "loading", message: "Creating quote ATA..." });
    try {
      try {
        await getAccount(connection, userQuoteAta);
        setStatus({ kind: "success", message: "Quote ATA already exists" });
        return;
      } catch {
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(publicKey, userQuoteAta, publicKey, quoteMint),
        );
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, "confirmed");
        setStatus({ kind: "success", message: "Quote ATA created", signature: sig });
      }
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Create ATA failed" });
    }
  };

  const createMarket = async () => {
    const program = requireProgram();
    const accounts = requireDerived();
    if (!program || !accounts || !quoteMint || !publicKey) return;
    setStatus({ kind: "loading", message: "Creating market..." });
    try {
      const sig = await program.methods
        .createMarket(new BN(marketId), question, new BN(endTime))
        .accounts({
          market: accounts.market,
          quoteMint,
          vault: accounts.vault,
          authority: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      setMarketInput(accounts.market.toBase58());
      await refreshMarket();
      setStatus({ kind: "success", message: "Market created", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Create market failed" });
    }
  };

  const placeBet = async () => {
    const program = requireProgram();
    if (!program || !activeMarket || !derived || !position || !userQuoteAta || !publicKey) return;
    setStatus({ kind: "loading", message: "Placing bet..." });
    try {
      const sig = await program.methods
        .placeBet(Number(betOutcome), new BN(betAmount))
        .accounts({
          market: activeMarket,
          vault: derived.vault,
          position,
          userQuoteAta,
          user: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      await refreshMarket();
      setStatus({ kind: "success", message: "Bet placed", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Place bet failed" });
    }
  };

  const resolveMarket = async () => {
    const program = requireProgram();
    if (!program || !activeMarket || !publicKey) return;
    setStatus({ kind: "loading", message: "Resolving market..." });
    try {
      const sig = await program.methods
        .resolve(Number(resolveOutcome))
        .accounts({
          market: activeMarket,
          authority: publicKey,
        } as any)
        .rpc();
      await refreshMarket();
      setStatus({ kind: "success", message: "Market resolved", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Resolve failed" });
    }
  };

  const claim = async () => {
    const program = requireProgram();
    if (!program || !activeMarket || !derived || !position || !userQuoteAta || !publicKey) return;
    setStatus({ kind: "loading", message: "Claiming reward..." });
    try {
      const sig = await program.methods
        .claim()
        .accounts({
          market: activeMarket,
          vault: derived.vault,
          position,
          userQuoteAta,
          user: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      await refreshMarket();
      setStatus({ kind: "success", message: "Reward claimed", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Claim failed" });
    }
  };

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>Prediction Market Console</h1>
          <p className="subtitle">Lesson 20 - Create / Bet / Resolve / Claim</p>
        </div>
        <WalletMultiButton />
      </header>

      <section className="card">
        <h2>Wallet</h2>
        <div className="row">
          <span className="label">Status</span>
          <span className="value">{connected ? "Connected" : "Disconnected"}</span>
        </div>
        <div className="row">
          <span className="label">Address</span>
          <span className="value">{publicKey?.toBase58() ?? "-"}</span>
        </div>
        <div className="row">
          <span className="label">Program</span>
          <span className="value">{PREDICTION_MARKET_PROGRAM_ID.toBase58()}</span>
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Market Config</h2>
          <label>Market ID</label>
          <input value={marketId} onChange={(e) => setMarketId(e.target.value)} />
          <label>Question</label>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} />
          <label>Quote mint</label>
          <input value={quoteMintInput} onChange={(e) => setQuoteMintInput(e.target.value)} />
          <label>End time</label>
          <input value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          <div className="actions">
            <button className="primary" disabled={!connected || status.kind === "loading"} onClick={createMarket}>
              Create Market
            </button>
            <button className="secondary" disabled={!connected || status.kind === "loading"} onClick={createAta}>
              Create Quote ATA
            </button>
          </div>
        </div>

        <div className="card">
          <h2>PDA Preview</h2>
          <div className="row">
            <span className="label">Market</span>
            <span className="value">{derived?.market.toBase58() ?? "-"}</span>
          </div>
          <div className="row">
            <span className="label">Vault</span>
            <span className="value">{derived?.vault.toBase58() ?? "-"}</span>
          </div>
          <div className="row">
            <span className="label">Position</span>
            <span className="value">{position?.toBase58() ?? "-"}</span>
          </div>
          <div className="row">
            <span className="label">Quote ATA</span>
            <span className="value">{userQuoteAta?.toBase58() ?? "-"}</span>
          </div>
          <label>Market override</label>
          <input value={marketInput} onChange={(e) => setMarketInput(e.target.value)} />
          <div className="actions">
            <button className="secondary" disabled={!activeMarket || status.kind === "loading"} onClick={refreshMarket}>
              Read Market
            </button>
          </div>
        </div>
      </section>

      <section className="grid three">
        <div className="card">
          <h2>Place Bet</h2>
          <label>Outcome</label>
          <select value={betOutcome} onChange={(e) => setBetOutcome(e.target.value)}>
            <option value="1">Outcome A</option>
            <option value="2">Outcome B</option>
          </select>
          <label>Amount</label>
          <input value={betAmount} onChange={(e) => setBetAmount(e.target.value)} />
          <div className="actions">
            <button className="primary" disabled={!connected || status.kind === "loading"} onClick={placeBet}>
              Place Bet
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Resolve</h2>
          <label>Winning outcome</label>
          <select value={resolveOutcome} onChange={(e) => setResolveOutcome(e.target.value)}>
            <option value="1">Outcome A</option>
            <option value="2">Outcome B</option>
          </select>
          <div className="actions">
            <button className="primary" disabled={!connected || status.kind === "loading"} onClick={resolveMarket}>
              Resolve Market
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Claim</h2>
          <p className="hint">Only winning positions can claim from the vault.</p>
          <div className="actions">
            <button className="primary" disabled={!connected || status.kind === "loading"} onClick={claim}>
              Claim Reward
            </button>
          </div>
        </div>
      </section>

      {marketView && (
        <section className="card">
          <h2>Market State</h2>
          {Object.entries(marketView).map(([key, value]) => (
            <div className="row" key={key}>
              <span className="label">{key}</span>
              <span className="value">{value}</span>
            </div>
          ))}
        </section>
      )}

      {status.kind !== "idle" && (
        <section className={`status ${status.kind === "loading" ? "loading" : status.kind === "error" ? "error" : "info"}`}>
          <div>{status.message}</div>
          {status.kind === "success" && status.signature && <small>tx: {status.signature}</small>}
        </section>
      )}
    </main>
  );
}
