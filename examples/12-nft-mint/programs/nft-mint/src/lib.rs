use anchor_lang::prelude::*;

declare_id!("3xJ79W2kFQSPetcKpAPXjvo6ixDSr5iVz2prJdFJk2V2");

/// NFT Mint 演示
///
/// 实际 NFT 创建（mint + metadata + master edition + mint to）由
/// TypeScript 调用 Metaplex Token Metadata 程序完成。
/// 这里的 program 提供一个简单的 `stamp_owner` 指令，用来在链上
/// 记录"该 NFT 已被某地址声明"的事件，方便后续业务扩展。
#[program]
pub mod nft_mint {
    use super::*;

    /// 记录 NFT 持有者关系。真实场景可对接 loyalty / 任务系统。
    pub fn stamp_owner(ctx: Context<StampOwner>) -> Result<()> {
        msg!(
            "NFT {} stamped to {}",
            ctx.accounts.nft_mint.key(),
            ctx.accounts.owner.key()
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct StampOwner<'info> {
    /// CHECK: 这是 NFT 的 mint account
    pub nft_mint: AccountInfo<'info>,

    /// 持有人
    pub owner: Signer<'info>,
}
