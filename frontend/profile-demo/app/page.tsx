"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PROFILE_PROGRAM_ID,
  PROFILE_SEED,
  deriveProfilePda,
  getProfileProgram,
} from "../lib/program";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };

export default function HomePage() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { connected, publicKey } = useWallet();

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [profile, setProfile] = useState<null | { name: string; bio: string; user: string; bump: number }>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const derived = useMemo(() => {
    if (!publicKey) return null;
    return deriveProfilePda(publicKey);
  }, [publicKey]);

  const fetchProfile = useCallback(async () => {
    if (!wallet || !derived) return;
    try {
      const program = getProfileProgram(connection, wallet);
      const acc = await (program.account as any).userProfile.fetch(derived.pda);
      setProfile({
        name: acc.name,
        bio: acc.bio,
        user: acc.user.toBase58(),
        bump: acc.bump,
      });
    } catch (err) {
      setProfile(null);
    }
  }, [connection, wallet, derived]);

  useEffect(() => {
    if (derived) {
      fetchProfile();
    } else {
      setProfile(null);
    }
  }, [derived, fetchProfile]);

  const handleCreate = async () => {
    if (!wallet || !publicKey || !derived) return;
    setStatus({ kind: "loading", message: "Creating profile..." });
    try {
      const program = getProfileProgram(connection, wallet);
      const sig = await program.methods
        .createProfile(name, bio)
        .accounts({
          user: publicKey,
        })
        .rpc();
      await fetchProfile();
      setStatus({
        kind: "success",
        message: "Profile created",
        signature: sig,
      });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Create failed" });
    }
  };

  const handleUpdate = async () => {
    if (!wallet || !publicKey || !derived) return;
    setStatus({ kind: "loading", message: "Updating profile..." });
    try {
      const program = getProfileProgram(connection, wallet);
      const sig = await program.methods
        .updateProfile(name, bio)
        .accounts({
          user: publicKey,
        })
        .rpc();
      await fetchProfile();
      setStatus({
        kind: "success",
        message: "Profile updated",
        signature: sig,
      });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Update failed" });
    }
  };

  const handleRefresh = async () => {
    setStatus({ kind: "loading", message: "Refreshing..." });
    try {
      await fetchProfile();
      setStatus({ kind: "success", message: "Profile refreshed" });
    } catch (err: any) {
      setStatus({ kind: "error", message: err?.message ?? "Refresh failed" });
    }
  };

  return (
    <main>
      <h1>PDA Profile Demo</h1>
      <p className="subtitle">
        Lesson 14 - 前端推导 PDA，无需 keypair
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
        <h2>PDA 推导</h2>
        <div className="row">
          <span className="label">Program ID</span>
          <span className="value">{PROFILE_PROGRAM_ID.toBase58()}</span>
        </div>
        <div className="row">
          <span className="label">Seeds</span>
          <span className="value">
            [&quot;{PROFILE_SEED}&quot;, wallet_pubkey]
          </span>
        </div>
        <div className="row">
          <span className="label">PDA</span>
          <span className="value">{derived?.pda.toBase58() ?? "(connect wallet first)"}</span>
        </div>
        <div className="row">
          <span className="label">Bump</span>
          <span className="value">{derived?.bump ?? "-"}</span>
        </div>
        <div className="seed-breakdown">
          PublicKey.findProgramAddressSync(
          <br />
          &nbsp;&nbsp;[Buffer.from(&quot;{PROFILE_SEED}&quot;), wallet.toBuffer()],
          <br />
          &nbsp;&nbsp;PROGRAM_ID
          <br />
          )
        </div>
      </div>

      <div className="card">
        <h2>Profile</h2>
        {profile ? (
          <>
            <div className="row">
              <span className="label">Name</span>
              <span className="value">{profile.name}</span>
            </div>
            <div className="row">
              <span className="label">Bio</span>
              <span className="value">{profile.bio}</span>
            </div>
            <div className="row">
              <span className="label">Owner</span>
              <span className="value">{profile.user}</span>
            </div>
            <div className="row">
              <span className="label">Stored bump</span>
              <span className="value">{profile.bump}</span>
            </div>
          </>
        ) : (
          <div style={{ padding: 12, color: "#9d9dbb", fontSize: 14 }}>
            Profile 还不存在。填写下方表单并点击 Create。
          </div>
        )}
      </div>

      <div className="card">
        <h2>{profile ? "Update Profile" : "Create Profile"}</h2>
        <div className="field">
          <label>Name (最长 50)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            placeholder="Alice"
          />
        </div>
        <div className="field">
          <label>Bio (最长 200)</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={200}
            placeholder="Solidity dev exploring Solana"
          />
        </div>
        <div className="actions">
          {!profile ? (
            <button
              className="primary"
              onClick={handleCreate}
              disabled={!connected || !name || status.kind === "loading"}
            >
              Create
            </button>
          ) : (
            <button
              className="primary"
              onClick={handleUpdate}
              disabled={!connected || !name || status.kind === "loading"}
            >
              Update
            </button>
          )}
          <button
            className="secondary"
            onClick={handleRefresh}
            disabled={status.kind === "loading"}
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
