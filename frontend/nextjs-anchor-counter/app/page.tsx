"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getCounterProgram, COUNTER_PROGRAM_ID } from "../lib/program";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };

export default function HomePage() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { connected, publicKey } = useWallet();

  const [counterPubkey, setCounterPubkey] = useState<PublicKey | null>(null);
  const [count, setCount] = useState<string>("-");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const fetchCount = useCallback(
    async (pk: PublicKey) => {
      if (!wallet) return;
      try {
        const program = getCounterProgram(connection, wallet);
        const account = await (program.account as any).counter.fetch(pk);
        setCount(account.count.toString());
      } catch (err) {
        console.warn("fetch count failed", err);
        setCount("(account not initialized)");
      }
    },
    [connection, wallet],
  );

  useEffect(() => {
    if (counterPubkey) {
      fetchCount(counterPubkey);
    }
  }, [counterPubkey, fetchCount]);

  const handleInitialize = async () => {
    if (!wallet || !publicKey) return;
    setStatus({ kind: "loading", message: "Initializing counter..." });
    try {
      const program = getCounterProgram(connection, wallet);
      const newCounter = Keypair.generate();
      const sig = await program.methods
        .initialize()
        .accounts({
          counter: newCounter.publicKey,
          user: publicKey,
        })
        .signers([newCounter])
        .rpc();
      setCounterPubkey(newCounter.publicKey);
      await fetchCount(newCounter.publicKey);
      setStatus({
        kind: "success",
        message: "Counter initialized successfully",
        signature: sig,
      });
    } catch (err: any) {
      setStatus({
        kind: "error",
        message: err?.message ?? "Initialize failed",
      });
    }
  };

  const handleIncrement = async () => {
    if (!wallet || !publicKey || !counterPubkey) return;
    setStatus({ kind: "loading", message: "Incrementing..." });
    try {
      const program = getCounterProgram(connection, wallet);
      const sig = await program.methods
        .increment()
        .accounts({
          counter: counterPubkey,
          authority: publicKey,
        })
        .rpc();
      await fetchCount(counterPubkey);
      setStatus({
        kind: "success",
        message: "Increment confirmed",
        signature: sig,
      });
    } catch (err: any) {
      setStatus({
        kind: "error",
        message: err?.message ?? "Increment failed",
      });
    }
  };

  const handleRefresh = async () => {
    if (!counterPubkey) return;
    setStatus({ kind: "loading", message: "Refreshing..." });
    try {
      await fetchCount(counterPubkey);
      setStatus({ kind: "success", message: "Counter refreshed" });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Refresh failed" });
    }
  };

  return (
    <main>
      <h1>Anchor Counter</h1>
      <p className="subtitle">
        Lesson 13 - Next.js + Anchor with Wallet Adapter
      </p>

      <div className="card">
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
          <span className="label">Program ID</span>
          <span className="value">{COUNTER_PROGRAM_ID.toBase58()}</span>
        </div>
        <div className="actions">
          <WalletMultiButton />
        </div>
      </div>

      <div className="card">
        <h2>Counter</h2>
        <div className="row">
          <span className="label">Account</span>
          <span className="value">{counterPubkey?.toBase58() ?? "(not created)"}</span>
        </div>
        <div className="count-big">{count}</div>
        <div className="actions">
          <button
            className="primary"
            onClick={handleInitialize}
            disabled={!connected || status.kind === "loading"}
          >
            Initialize
          </button>
          <button
            className="primary"
            onClick={handleIncrement}
            disabled={!connected || !counterPubkey || status.kind === "loading"}
          >
            Increment
          </button>
          <button
            className="secondary"
            onClick={handleRefresh}
            disabled={!counterPubkey || status.kind === "loading"}
          >
            Refresh
          </button>
        </div>
      </div>

      {status.kind !== "idle" && (
        <div className={`status ${status.kind === "loading" ? "loading" : status.kind === "error" ? "error" : "info"}`}>
          <div>{status.message}</div>
          {status.kind === "success" && status.signature && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
              tx: {status.signature}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
