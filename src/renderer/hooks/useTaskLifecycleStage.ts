import { usePrStatus } from './usePrStatus';
import { useCheckRuns } from './useCheckRuns';
import { computeLifecycleInfo, deriveLifecycleStage } from '../lib/lifecycleStage';
import type { LifecycleInfo, LifecycleStage } from '../lib/lifecycleStage';

/**
 * Returns the lifecycle stage and status dot info for a task.
 *
 * Subscribes to both PR status and check runs (check runs only enabled
 * when a PR exists, avoiding unnecessary gh CLI calls).
 */
export function useTaskLifecycleStage(taskPath?: string): {
  stage: LifecycleStage;
  info: LifecycleInfo;
  isLoading: boolean;
} {
  const { pr, isLoading: prLoading } = usePrStatus(taskPath);
  const hasPr = !!pr;
  const { status: checkRuns } = useCheckRuns(taskPath, hasPr);

  const stage = deriveLifecycleStage(pr);
  const info = computeLifecycleInfo(pr, checkRuns);

  return { stage, info, isLoading: prLoading };
}
