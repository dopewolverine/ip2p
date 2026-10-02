import { ethers } from 'ethers';
// Token escrow is deliberately unavailable until a pinned contract source,
// reproducible ABI, dispute authorization and testnet deployment are verified.
// This module contains only the standard ERC20 allowance helper and metadata.

const ERC20_APPROVE_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export interface ContractEscrowDeployment {
  chain: 'ethereum' | 'tron';
  contractAddress: string;
  arbitratorAddress: string; // derived from the Owner's hardware wallet — never a server-held key
  feeRateBps: number;
}

// Spec §5.4 / §4A.8 - the required approve-to-zero-first sequence,
// re-checked on every funding attempt (never assume the allowance is
// zero), waiting for confirmation between steps (never fire the second
// approval before the first confirms - that produces exactly the revert
// this sequence exists to avoid).
export async function buildApprovalSequence(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  requiredAmount: bigint
): Promise<{ needsZeroFirst: boolean; needsApproval: boolean; currentAllowance: bigint }> {
  const token = new ethers.Contract(tokenAddress, ERC20_APPROVE_ABI, provider);
  const current: bigint = await token.getFunction('allowance')(ownerAddress, spenderAddress);

  if (current === requiredAmount) {
    return { needsZeroFirst: false, needsApproval: false, currentAllowance: current };
  }

  return {
    needsZeroFirst: current > 0n,
    needsApproval: true,
    currentAllowance: current,
  };
}

// Spec §5.3 - one contract per chain, deployed once. This reads which
// deployment is on file; it does not deploy anything (deployment is a
// one-time operational action a human runs, never something request-
// handling code triggers). Returns null until a row has been inserted
// by hand - which itself should only happen after the §1 prerequisite
// (reading and verifying the actual contract source) is done.
export async function getActiveDeployment(chain: 'ethereum' | 'tron'): Promise<ContractEscrowDeployment | null> {
  const { pool } = await import('../db/pool');
  const { rows } = await pool.query(
    `SELECT contract_address, arbitrator_address, fee_rate_bps
     FROM contract_deployments WHERE chain = $1 AND active = true`,
    [chain]
  );
  if (!rows[0]) return null;
  return {
    chain,
    contractAddress: rows[0].contract_address,
    arbitratorAddress: rows[0].arbitrator_address,
    feeRateBps: rows[0].fee_rate_bps,
  };
}
