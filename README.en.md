# Solana Anchor Tutorial for EVM Developers

> **Languages:** [简体中文](README.md) | English
>
> From Solidity to Anchor, from ERC-20 to SPL Token, from Uniswap to Solana DeFi.
>
> A hands-on guide for Web3 developers who already know Solidity. Learn Solana program development, the Anchor framework, SPL Token, NFTs, full-stack DApps, and production best practices — with explicit EVM comparisons and the boundaries of each analogy called out.

## Who This Is For

This is not a generic Solana intro. It is a migration guide built specifically for developers already fluent in **Solidity / Foundry / EVM**. Every Solana concept is paired with an EVM analogy, and the limits of that analogy are stated explicitly.

## Target Audience

- Solidity developers
- Foundry developers
- ETH / Base / Arbitrum developers
- Web3 full-stack developers
- Anyone moving from EVM to Solana

## Learning Outcomes

By the end of this tutorial you will be able to:

- Understand the Solana account model
- Build programs fluently with Anchor
- Master PDA, CPI, and SPL Token
- Build Solana DApps end-to-end
- Ship projects such as Launchpad, Escrow, and Voting
- Read source code of projects like Jupiter, Pump.fun, and Drift

## Directory Structure

```
.
├── docs/                  # Lesson documents (6)
│   ├── 01-evm-vs-solana.md
│   ├── 02-common-pitfalls.md
│   ├── 03-evm-solana-mapping.md
│   ├── 11-erc721-metaplex.md
│   ├── 21-anchor-security.md
│   └── 25-jupiter-architecture.md
├── examples/              # Anchor programs & simulation models
│   ├── 04-counter/                   # Anchor: Counter
│   ├── 05-account-space/             # Anchor: Account Space
│   ├── 06-pda-user-profile/          # Anchor: PDA replaces mapping
│   ├── 07-cpi-transfer-sol/          # Anchor: CPI intro
│   ├── 08-spl-token/                 # Anchor: SPL Token
│   ├── 09-token2022/                 # Anchor: Token-2022 extensions
│   ├── 10-meme-coin/                 # Anchor: Meme Coin
│   ├── 12-nft-mint/                  # Anchor: NFT Mint Account basics
│   ├── 16-escrow/                    # Anchor: Escrow
│   ├── 17-voting/                    # Anchor: Voting
│   ├── 18-airdrop/                   # Anchor: Airdrop
│   ├── 19-launchpad/                 # Anchor: Launchpad
│   ├── 20-prediction-market/         # Anchor: Prediction Market
│   ├── 22-anchor-testing/            # Anchor: Testing
│   ├── 23-errors-events/             # Anchor: Errors & Events
│   ├── 26-bonding-curve-simulation/  # Simulation: Pump.fun
│   └── 27-simple-perp-model/         # Simulation: Drift
├── frontend/              # Frontend examples (5)
│   ├── nextjs-anchor-counter/  # Lesson 13: Next.js + Anchor
│   ├── profile-demo/           # Lesson 14: Derive PDA on the client
│   ├── spl-token-demo/         # Lesson 15: SPL Token from the frontend
│   ├── launchpad/              # Lesson 19: Launchpad frontend
│   └── prediction-market/      # Lesson 20: Prediction Market frontend
├── scripts/               # Deploy scripts & ops docs
│   └── deploy-devnet.md        # Lesson 24: Devnet deployment guide
└── README.md             # Project intro (Chinese)
```

## Prerequisites

| Tool        | Version   | Purpose                        |
| ----------- | --------- | ------------------------------ |
| Node.js     | v24.0.1+  | Frontend & Anchor client       |
| npm         | 11.3.0+   | Package management             |
| Rust        | 1.86.0+   | Compile Anchor programs        |
| Cargo       | 1.86.0+   | Rust package manager           |
| Solana CLI  | 2.1.22+   | Interact with the chain        |
| Anchor CLI  | 0.31.1+   | Anchor framework               |

Verify your environment:

```bash
node --version
npm --version
rustc --version
cargo --version
solana --version
anchor --version
```

## Curriculum

The tutorial is split into 4 phases and 27 lessons.

### Phase 1 — Start Here

| Lesson | Type   | Topic                                          |
| ------ | ------ | ---------------------------------------------- |
| 01     | Doc    | Why Solana is fundamentally different from EVM |
| 02     | Doc    | Top 10 pitfalls for Solidity developers        |
| 03     | Doc    | EVM ↔ Solana concept mapping                   |
| 04     | Anchor | Your first Anchor Counter                      |
| 06     | Anchor | PDA intro: implementing a mapping              |
| 07     | Anchor | CPI intro                                      |
| 08     | Anchor | ERC-20 vs SPL Token                            |
| 16     | Anchor | Escrow                                         |

### Phase 2 — Complete Foundations

| Lesson | Type     | Topic                                  |
| ------ | -------- | -------------------------------------- |
| 05     | Anchor   | Account, Space, and Discriminator      |
| 09     | Anchor   | Token-2022                             |
| 10     | Anchor   | Create a Meme Coin                     |
| 11     | Doc      | ERC-721 vs Metaplex                    |
| 12     | Anchor   | NFT Mint Account basics                |
| 13     | Frontend | Next.js + Anchor                       |
| 14     | Frontend | Derive PDA on the client               |
| 15     | Frontend | SPL Token from the frontend            |

### Phase 3 — Project Practice

| Lesson | Type        | Topic             |
| ------ | ----------- | ----------------- |
| 17     | Anchor      | Voting system     |
| 18     | Anchor      | Airdrop system    |
| 19     | Anchor+FE   | Launchpad         |
| 20     | Anchor+FE   | Prediction Market |

### Phase 4 — Security, Deployment & Source Reading

| Lesson | Type   | Topic                                  |
| ------ | ------ | -------------------------------------- |
| 21     | Doc    | Anchor security                        |
| 22     | Anchor | Testing                                |
| 23     | Anchor | Error codes & events                   |
| 24     | Doc    | Devnet deployment                      |
| 25     | Doc    | Jupiter architecture teardown          |
| 26     | Sim    | Pump.fun bonding curve                 |
| 27     | Sim    | Drift perp simplified model            |

## How to Use

### Option A — Follow the phases in order

1. Read the Phase 1 docs (Lessons 01–03)
2. Build the Phase 1 projects (Lessons 04–08, 16)
3. Move on to the next phase

### Option B — Learn by topic

- **Solana model**: Lessons 01–03
- **Anchor basics**: Lessons 04–07
- **Tokens**: Lessons 08–10
- **NFTs**: Lessons 11–12 (Lesson 12 focuses on Mint Account basics; full Metaplex is out of scope)
- **Frontend**: Lessons 13–15
- **Projects**: Lessons 16–20
- **Security & quality**: Lessons 21–23
- **Deploy & production**: Lesson 24
- **Source reading & models**: Lessons 25–27 (Jupiter doc / Pump.fun simulation / Drift simulation)

## Verify Commands

```bash
# Anchor project (lint scans only tests/ to avoid target/types/)
cd examples/<lesson>/
npm install
anchor build
npm run lint          # prettier "tests/**/*.ts" --check
anchor test           # starts/stops a local validator on port 8899

# Frontend project
cd frontend/<project>/
npm install
npm run lint
npm run build

# Simulation project (Lesson 26 / 27)
cd examples/26-bonding-curve-simulation/  # or 27-simple-perp-model/
npm install
npm test
```

## Contributing

Every lesson ships its own `README.md` and `docs.md`. Work through lessons in order, and before moving on, run the "Verify Commands" section of each lesson's README to confirm tests pass.

Found a mistake or have a suggestion? Issues and PRs are welcome.

---

**Last updated:** 2026-06-11
