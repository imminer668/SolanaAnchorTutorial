"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };

type BalanceInfo = {
  ata: PublicKey;
  exists: boolean;
  amount: bigint;
  decimals: number;
  uiAmount: string;
};

export default function HomePage() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [mintInput, setMintInput] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [info, setInfo] = useState<BalanceInfo | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (publicKey && !ownerInput) {
      setOwnerInput(publicKey.toBase58());
    }
  }, [publicKey, ownerInput]);

  const mintPubkey = useMemo(() => {
    try {
      return mintInput ? new PublicKey(mintInput) : null;
    } catch {
      return null;
    }
  }, [mintInput]);

  const ownerPubkey = useMemo(() => {
    try {
      return ownerInput ? new PublicKey(ownerInput) : null;
    } catch {
      return null;
    }
  }, [ownerInput]);

  const handleRead = useCallback(async () => {
    if (!mintPubkey || !ownerPubkey) {
      setStatus({ kind: "error", message: "请填写有效的 mint 和 owner 地址" });
      return;
    }
    setStatus({ kind: "loading", message: "Loading balance..." });
    try {
      const mintInfo = await getMint(connection, mintPubkey);
      const ata = getAssociatedTokenAddressSync(mintPubkey, ownerPubkey);
      try {
        const account = await getAccount(connection, ata);
        const ui = Number(account.amount) / 10 ** mintInfo.decimals;
        setInfo({
          ata,
          exists: true,
          amount: account.amount,
          decimals: mintInfo.decimals,
          uiAmount: ui.toString(),
        });
        setStatus({ kind: "success", message: "Balance loaded" });
      } catch {
        setInfo({
          ata,
          exists: false,
          amount: 0n,
          decimals: mintInfo.decimals,
          uiAmount: "0",
        });
        setStatus({ kind: "success", message: "ATA does not exist yet" });
      }
    } catch (err: any) {
      setInfo(null);
      setStatus({ kind: "error", message: err?.message ?? "Read failed" });
    }
  }, [connection, mintPubkey, ownerPubkey]);

  const handleCreateAta = async () => {
    if (!publicKey || !mintPubkey || !ownerPubkey) return;
    setStatus({ kind: "loading", message: "Creating ATA..." });
    try {
      const ata = getAssociatedTokenAddressSync(mintPubkey, ownerPubkey);
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          publicKey,
          ata,
          ownerPubkey,
          mintPubkey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      await handleRead();
      setStatus({ kind: "success", message: "ATA created", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Create ATA failed" });
    }
  };

  const handleTransfer = async () => {
    if (!publicKey || !mintPubkey || !info) return;
    let toPubkey: PublicKey;
    try {
      toPubkey = new PublicKey(transferTo);
    } catch {
      setStatus({ kind: "error", message: "Invalid recipient address" });
      return;
    }

    const amount = Number(transferAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus({ kind: "error", message: "Invalid amount" });
      return;
    }

    setStatus({ kind: "loading", message: "Transferring..." });
    try {
      const fromAta = getAssociatedTokenAddressSync(mintPubkey, publicKey);
      const toAta = getAssociatedTokenAddressSync(mintPubkey, toPubkey);

      const tx = new Transaction();

      // 检查 recipient ATA 是否存在，不存在则创建
      try {
        await getAccount(connection, toAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            toAta,
            toPubkey,
            mintPubkey,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
      }

      const rawAmount = BigInt(Math.floor(amount * 10 ** info.decimals));
      tx.add(
        createTransferInstruction(
          fromAta,
          toAta,
          publicKey,
          rawAmount,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      await handleRead();
      setStatus({ kind: "success", message: "Transfer confirmed", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Transfer failed" });
    }
  };

  return (
    <main>
      <h1>SPL Token Demo</h1>
      <p className="subtitle">
        Lesson 15 - Read Balance / Create ATA / Transfer
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
        <div className="actions">
          <WalletMultiButton />
        </div>
      </div>

      <div className="card">
        <h2>Query</h2>
        <div className="field">
          <label>Mint address</label>
          <input
            value={mintInput}
            onChange={(e) => setMintInput(e.target.value)}
            placeholder="例如：EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (USDC mainnet)"
          />
        </div>
        <div className="field">
          <label>Owner address</label>
          <input
            value={ownerInput}
            onChange={(e) => setOwnerInput(e.target.value)}
            placeholder="默认填入当前钱包地址"
          />
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={handleRead}
            disabled={!mintPubkey || !ownerPubkey || status.kind === "loading"}
          >
            Read Balance
          </button>
        </div>
      </div>

      {info && (
        <div className="card">
          <h2>Token Account</h2>
          <div className="row">
            <span className="label">ATA</span>
            <span className="value">{info.ata.toBase58()}</span>
          </div>
          <div className="row">
            <span className="label">Decimals</span>
            <span className="value">{info.decimals}</span>
          </div>
          <div className="row">
            <span className="label">Status</span>
            <span className="value">
              {info.exists ? "Initialized" : "Not yet created"}
            </span>
          </div>
          <div className="balance-big">{info.uiAmount}</div>
          <div className="subtle">raw amount: {info.amount.toString()}</div>
          {!info.exists && publicKey && (
            <div className="actions">
              <button
                className="primary"
                onClick={handleCreateAta}
                disabled={status.kind === "loading"}
              >
                Create ATA
              </button>
            </div>
          )}
        </div>
      )}

      {info && info.exists && publicKey && ownerPubkey?.equals(publicKey) && (
        <div className="card">
          <h2>Transfer</h2>
          <div className="field">
            <label>To (recipient owner address)</label>
            <input
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
              placeholder="recipient pubkey"
            />
          </div>
          <div className="field">
            <label>Amount (UI 单位)</label>
            <input
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              placeholder={`例：1.5（decimals=${info.decimals}）`}
            />
          </div>
          <div className="actions">
            <button
              className="primary"
              onClick={handleTransfer}
              disabled={status.kind === "loading"}
            >
              Transfer
            </button>
          </div>
        </div>
      )}

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
