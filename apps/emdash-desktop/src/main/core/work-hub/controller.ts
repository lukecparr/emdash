import type { WorkHubSnapshot } from '@shared/core/work-hub/work-hub';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { getWorkHubSnapshot } from './work-hub-service';

export const workHubController = createRPCController({
  getSnapshot: (): Promise<WorkHubSnapshot> => getWorkHubSnapshot(),
});
