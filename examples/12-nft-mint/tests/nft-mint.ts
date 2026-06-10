import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { NftMint } from "../target/types/nft_mint";
import { assert } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  MINT_SIZE,
  createInitializeMintInstruction,
  createMintToInstruction,
} from "@solana/spl-token";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

describe("nft-mint", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.nftMint as Program<NftMint>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  let nftMint: Keypair;
  let nftMintPubkey: PublicKey;
  let ownerAta: PublicKey;
  let metadataPda: PublicKey;
  let masterEditionPda: PublicKey;

  function deriveMetaplexPdas(mint: PublicKey) {
    const [metadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    const [masterEdition] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    return { metadata, masterEdition };
  }

  it("creates an NFT mint account with supply 1 and decimals 0", async () => {
    nftMint = Keypair.generate();
    nftMintPubkey = nftMint.publicKey;
    ownerAta = getAssociatedTokenAddressSync(nftMintPubkey, wallet.publicKey);
    const pdas = deriveMetaplexPdas(nftMintPubkey);
    metadataPda = pdas.metadata;
    masterEditionPda = pdas.masterEdition;

    const mintRent = await connection.getMinimumBalanceForRentExemption(
      MINT_SIZE
    );
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: nftMintPubkey,
        lamports: mintRent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(nftMintPubkey, 0, wallet.publicKey, null),
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        ownerAta,
        wallet.publicKey,
        nftMintPubkey
      ),
      createMintToInstruction(nftMintPubkey, ownerAta, wallet.publicKey, 1)
    );

    await provider.sendAndConfirm(tx, [nftMint]);

    // 验证 mint
    const mintInfo = await getMint(connection, nftMintPubkey);
    assert.strictEqual(mintInfo.supply, 1n, "supply should be 1");
    assert.strictEqual(mintInfo.decimals, 0, "decimals should be 0");
    assert.ok(mintInfo.mintAuthority?.equals(wallet.publicKey));

    // 验证 owner 持有 1 个 token
    const ownerAccount = await getAccount(connection, ownerAta);
    assert.strictEqual(ownerAccount.amount, 1n, "owner should hold 1 NFT");
    assert.ok(ownerAccount.owner.equals(wallet.publicKey));

    // 验证 metadata 账户派生正确（即使还没初始化）
    const [expectedMetadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        nftMintPubkey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    assert.ok(expectedMetadata.equals(metadataPda));
  });

  it("records the current one-token NFT supply boundary", async () => {
    // 由于我们没有调用 setAuthority(mint, None)，仍然可以 mint
    // 但这里验证 supply=1 是当前状态
    const mintInfo = await getMint(connection, nftMintPubkey);
    assert.strictEqual(mintInfo.supply, 1n);
  });

  it("documents that metadata account is not created in this local lesson", async () => {
    // 本课只推导 Metadata/Master Edition PDA，不在 local validator 中创建 Metaplex accounts。
    const metadataInfo = await connection.getAccountInfo(metadataPda);
    assert.isNull(
      metadataInfo,
      "metadata account not yet created in this lesson"
    );
  });

  it("calls our anchor program to stamp owner", async () => {
    const sig = await program.methods
      .stampOwner()
      .accounts({
        nftMint: nftMintPubkey,
        owner: wallet.publicKey,
      })
      .rpc();
    await connection.confirmTransaction(sig);
    assert.ok(sig);
  });
});
