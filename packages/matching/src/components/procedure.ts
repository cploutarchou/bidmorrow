/**
 * Procedure / contract nature (5 pts). docs/matching-engine.md
 * §Procedure/contract nature.
 */
import { COMPONENT_MAX } from '../index';
import type { ComponentResult, ContractNature, OrgProfile } from '../types';

/** Procedure types accessible to newcomers (BT-105 codes), scoring +2. */
const OPEN_PROCEDURE_CODES = new Set(['open', 'restricted']);

export function scoreProcedure(
  contractNature: ContractNature | null,
  procedureType: string | null,
  org: OrgProfile,
): ComponentResult {
  const maxPoints = COMPONENT_MAX.procedure;

  let naturePoints = 0;
  let natureText: string;
  if (contractNature === null) {
    natureText = 'contract nature not published';
  } else if (org.supportedContractNatures.includes(contractNature)) {
    naturePoints = 3;
    natureText = `${contractNature} supported (+3)`;
  } else {
    natureText = `${contractNature} not in your supported natures`;
  }

  let procedurePoints = 0;
  let procedureText: string;
  if (procedureType === null) {
    procedureText = 'procedure type not published';
  } else if (OPEN_PROCEDURE_CODES.has(procedureType)) {
    procedurePoints = 2;
    procedureText = `${procedureType} procedure (+2)`;
  } else {
    procedureText = `${procedureType} procedure (restricted access, +0)`;
  }

  const points = naturePoints + procedurePoints;
  const status: ComponentResult['status'] =
    contractNature === null && procedureType === null
      ? 'UNKNOWN'
      : points >= maxPoints
        ? 'MATCHED'
        : points > 0
          ? 'PARTIAL'
          : 'NO_MATCH';

  if (status === 'UNKNOWN') {
    return {
      key: 'procedure',
      points: maxPoints * 0.5,
      maxPoints,
      status,
      explanation:
        'Procedure: contract nature and procedure type both not published — neutral score applied.',
    };
  }

  return {
    key: 'procedure',
    points,
    maxPoints,
    status,
    explanation: `Procedure: ${natureText}, ${procedureText}`,
  };
}
