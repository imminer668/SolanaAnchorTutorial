"use client";

import { useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import {
  LAUNCHPAD_PROGRAM_ID,
  deriveContribution,
  deriveLaunchpadPool,
  getLaunchpadProgram,
} from "../lib/program";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };

type PoolView = {
  authority: string;
  saleMint: string;
  quoteMint: string;
  price: string;
  softCap: string;
  hardCap: string;
  totalQuoteRaised: string;
  startTime: string;
  endTime: string;
  status: string;
};

const poolStatusLabel = ["Active", "Succeeded", "Failed", "Finalized"];

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

export default function HomePage() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { connected, publicKey, sendTransaction } = useWallet();

  const [saleMintInput, setSaleMintInput] = useState("");
  const [quoteMintInput, setQuoteMintInput] = useState("");
  const [poolInput, setPoolInput] = useState("");
  const [price, setPrice] = useState("100");
  const [softCap, setSoftCap] = useState("50000000");
  const [hardCap, setHardCap] = useState("200000000");
  const [startTime, setStartTime] = useState("0");
  const [endTime, setEndTime] = useState(String(nowSeconds(86400)));
  const [depositAmount, setDepositAmount] = useState("100000000000");
  const [contributeAmount, setContributeAmount] = useState("60000000");
  const [poolView, setPoolView] = useState<PoolView | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const saleMint = useMemo(() => parsePubkey(saleMintInput), [saleMintInput]);
  const quoteMint = useMemo(() => parsePubkey(quoteMintInput), [quoteMintInput]);

  const derived = useMemo(() => {
    if (!publicKey || !saleMint || !quoteMint) return null;
    return deriveLaunchpadPool(publicKey, saleMint, quoteMint);
  }, [publicKey, quoteMint, saleMint]);

  const activePool = useMemo(() => {
    return parsePubkey(poolInput) ?? derived?.pool ?? null;
  }, [derived?.pool, poolInput]);

  const contribution = useMemo(() => {
    if (!activePool || !publicKey) return null;
    return deriveContribution(activePool, publicKey);
  }, [activePool, publicKey]);

  const authoritySaleAta = useMemo(() => {
    if (!publicKey || !saleMint) return null;
    return getAssociatedTokenAddressSync(saleMint, publicKey);
  }, [publicKey, saleMint]);

  const authorityQuoteAta = useMemo(() => {
    if (!publicKey || !quoteMint) return null;
    return getAssociatedTokenAddressSync(quoteMint, publicKey);
  }, [publicKey, quoteMint]);

  const setError = (message: string) => setStatus({ kind: "error", message });

  const requireProgram = () => {
    if (!wallet || !publicKey) {
      setError("请先连接钱包");
      return null;
    }
    return getLaunchpadProgram(connection, wallet);
  };

  const requirePoolAccounts = () => {
    if (!publicKey || !saleMint || !quoteMint) {
      setError("请填写有效的 sale mint 和 quote mint");
      return null;
    }
    return deriveLaunchpadPool(publicKey, saleMint, quoteMint);
  };

  const refreshPool = async () => {
    const program = requireProgram();
    if (!program || !activePool) return;
    setStatus({ kind: "loading", message: "Reading pool..." });
    try {
      const account = await (program.account as any).launchpadPool.fetch(activePool);
      setPoolView({
        authority: account.authority.toBase58(),
        saleMint: account.saleMint.toBase58(),
        quoteMint: account.quoteMint.toBase58(),
        price: account.price.toString(),
        softCap: account.softCap.toString(),
        hardCap: account.hardCap.toString(),
        totalQuoteRaised: account.totalQuoteRaised.toString(),
        startTime: account.startTime.toString(),
        endTime: account.endTime.toString(),
        status: poolStatusLabel[account.status] ?? String(account.status),
      });
      setStatus({ kind: "success", message: "Pool loaded" });
    } catch (err: any) {
      setPoolView(null);
      setStatus({ kind: "error", message: err?.message ?? "Read pool failed" });
    }
  };

  const createPool = async () => {
    const program = requireProgram();
    const accounts = requirePoolAccounts();
    if (!program || !accounts || !publicKey || !saleMint || !quoteMint) return;
    setStatus({ kind: "loading", message: "Creating pool..." });
    try {
      const sig = await program.methods
        .createPool(
          new BN(price),
          new BN(softCap),
          new BN(hardCap),
          new BN(startTime),
          new BN(endTime),
        )
        .accounts({
          pool: accounts.pool,
          saleMint,
          quoteMint,
          saleVault: accounts.saleVault,
          quoteVault: accounts.quoteVault,
          authority: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      setPoolInput(accounts.pool.toBase58());
      await refreshPool();
      setStatus({ kind: "success", message: "Pool created", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Create pool failed" });
    }
  };

  const createAta = async (mint: PublicKey | null, ownerAta: PublicKey | null, label: string) => {
    if (!publicKey || !mint || !ownerAta) {
      setError(`无法创建 ${label} ATA：mint 或钱包无效`);
      return;
    }
    setStatus({ kind: "loading", message: `Creating ${label} ATA...` });
    try {
      try {
        await getAccount(connection, ownerAta);
        setStatus({ kind: "success", message: `${label} ATA already exists` });
        return;
      } catch {
        const tx = new Transaction().add(
          createAssociatedTokenAccountInstruction(publicKey, ownerAta, publicKey, mint),
        );
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, "confirmed");
        setStatus({ kind: "success", message: `${label} ATA created`, signature: sig });
      }
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? `Create ${label} ATA failed` });
    }
  };

  const depositSaleToken = async () => {
    const program = requireProgram();
    if (!program || !activePool || !derived || !authoritySaleAta || !publicKey) return;
    setStatus({ kind: "loading", message: "Depositing sale token..." });
    try {
      const sig = await program.methods
        .depositSaleToken(new BN(depositAmount))
        .accounts({
          pool: activePool,
          saleVault: derived.saleVault,
          authoritySaleAta,
          authority: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      await refreshPool();
      setStatus({ kind: "success", message: "Sale token deposited", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Deposit failed" });
    }
  };

  const contribute = async () => {
    const program = requireProgram();
    if (!program || !activePool || !derived || !contribution || !authorityQuoteAta || !publicKey) return;
    setStatus({ kind: "loading", message: "Contributing quote token..." });
    try {
      const sig = await program.methods
        .contribute(new BN(contributeAmount))
        .accounts({
          pool: activePool,
          saleVault: derived.saleVault,
          quoteVault: derived.quoteVault,
          contribution,
          userQuoteAta: authorityQuoteAta,
          user: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      await refreshPool();
      setStatus({ kind: "success", message: "Contribution confirmed", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Contribute failed" });
    }
  };

  const claim = async () => {
    const program = requireProgram();
    if (!program || !activePool || !derived || !contribution || !authoritySaleAta || !publicKey) return;
    setStatus({ kind: "loading", message: "Claiming sale token..." });
    try {
      const sig = await program.methods
        .claim()
        .accounts({
          pool: activePool,
          saleVault: derived.saleVault,
          contribution,
          userSaleAta: authoritySaleAta,
          user: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      await refreshPool();
      setStatus({ kind: "success", message: "Claim confirmed", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Claim failed" });
    }
  };

  const refund = async () => {
    const program = requireProgram();
    if (!program || !activePool || !derived || !contribution || !authorityQuoteAta || !publicKey) return;
    setStatus({ kind: "loading", message: "Refunding quote token..." });
    try {
      const sig = await program.methods
        .refund()
        .accounts({
          pool: activePool,
          quoteVault: derived.quoteVault,
          contribution,
          userQuoteAta: authorityQuoteAta,
          user: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      await refreshPool();
      setStatus({ kind: "success", message: "Refund confirmed", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Refund failed" });
    }
  };

  const withdraw = async () => {
    const program = requireProgram();
    if (!program || !activePool || !derived || !authorityQuoteAta || !authoritySaleAta || !publicKey) return;
    setStatus({ kind: "loading", message: "Withdrawing pool funds..." });
    try {
      const sig = await program.methods
        .withdraw()
        .accounts({
          pool: activePool,
          quoteVault: derived.quoteVault,
          saleVault: derived.saleVault,
          authorityQuoteAta,
          authoritySaleAta,
          authority: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      await refreshPool();
      setStatus({ kind: "success", message: "Withdraw confirmed", signature: sig });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Withdraw failed" });
    }
  };

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>Launchpad Console</h1>
          <p className="subtitle">Lesson 19 - Pool / Contribution / Claim / Refund</p>
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
          <span className="value">{LAUNCHPAD_PROGRAM_ID.toBase58()}</span>
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Pool Config</h2>
          <label>Sale mint</label>
          <input value={saleMintInput} onChange={(e) => setSaleMintInput(e.target.value)} />
          <label>Quote mint</label>
          <input value={quoteMintInput} onChange={(e) => setQuoteMintInput(e.target.value)} />
          <div className="split">
            <div>
              <label>Price</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <label>Soft cap</label>
              <input value={softCap} onChange={(e) => setSoftCap(e.target.value)} />
            </div>
          </div>
          <label>Hard cap</label>
          <input value={hardCap} onChange={(e) => setHardCap(e.target.value)} />
          <div className="split">
            <div>
              <label>Start time</label>
              <input value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <label>End time</label>
              <input value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="actions">
            <button className="primary" disabled={!connected || status.kind === "loading"} onClick={createPool}>
              Create Pool
            </button>
          </div>
        </div>

        <div className="card">
          <h2>PDA Preview</h2>
          <div className="row">
            <span className="label">Pool</span>
            <span className="value">{derived?.pool.toBase58() ?? "-"}</span>
          </div>
          <div className="row">
            <span className="label">Sale vault</span>
            <span className="value">{derived?.saleVault.toBase58() ?? "-"}</span>
          </div>
          <div className="row">
            <span className="label">Quote vault</span>
            <span className="value">{derived?.quoteVault.toBase58() ?? "-"}</span>
          </div>
          <div className="row">
            <span className="label">Contribution</span>
            <span className="value">{contribution?.toBase58() ?? "-"}</span>
          </div>
          <label>Pool override</label>
          <input value={poolInput} onChange={(e) => setPoolInput(e.target.value)} />
          <div className="actions">
            <button className="secondary" disabled={!activePool || status.kind === "loading"} onClick={refreshPool}>
              Read Pool
            </button>
          </div>
        </div>
      </section>

      <section className="grid three">
        <div className="card">
          <h2>Prepare ATA</h2>
          <div className="row">
            <span className="label">Sale ATA</span>
            <span className="value">{authoritySaleAta?.toBase58() ?? "-"}</span>
          </div>
          <div className="row">
            <span className="label">Quote ATA</span>
            <span className="value">{authorityQuoteAta?.toBase58() ?? "-"}</span>
          </div>
          <div className="actions">
            <button className="secondary" disabled={!connected} onClick={() => createAta(saleMint, authoritySaleAta, "sale")}>
              Create Sale ATA
            </button>
            <button className="secondary" disabled={!connected} onClick={() => createAta(quoteMint, authorityQuoteAta, "quote")}>
              Create Quote ATA
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Fund / Buy</h2>
          <label>Sale deposit amount</label>
          <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
          <label>Contribute quote amount</label>
          <input value={contributeAmount} onChange={(e) => setContributeAmount(e.target.value)} />
          <div className="actions">
            <button className="primary" disabled={!connected || status.kind === "loading"} onClick={depositSaleToken}>
              Deposit Sale Token
            </button>
            <button className="primary" disabled={!connected || status.kind === "loading"} onClick={contribute}>
              Contribute
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Settle</h2>
          <div className="actions vertical">
            <button className="primary" disabled={!connected || status.kind === "loading"} onClick={claim}>
              Claim
            </button>
            <button className="secondary" disabled={!connected || status.kind === "loading"} onClick={refund}>
              Refund
            </button>
            <button className="secondary" disabled={!connected || status.kind === "loading"} onClick={withdraw}>
              Withdraw
            </button>
          </div>
        </div>
      </section>

      {poolView && (
        <section className="card">
          <h2>Pool State</h2>
          {Object.entries(poolView).map(([key, value]) => (
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
