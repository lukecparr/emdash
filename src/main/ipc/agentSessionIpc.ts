import { ipcMain } from 'electron';
import { agentSessionService } from '../services/AgentSessionService';
import { log } from '../lib/logger';

export function registerAgentSessionIpc(): void {
  ipcMain.handle(
    'agentSession:create',
    async (
      event,
      opts: {
        sessionId: string;
        cwd: string;
        providerId: string;
        autoApprove: boolean;
        conversationId: string;
        taskId: string;
        env?: Record<string, string>;
        resume?: boolean;
      }
    ) => {
      try {
        // Attach the window so events can be pushed back to the renderer
        agentSessionService.attachWindow(event.sender);
        const history = await agentSessionService.createSession(opts.sessionId, opts);
        return { ok: true, history };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('[agentSessionIpc] create error:', err);
        return { ok: false, error: message };
      }
    }
  );

  ipcMain.handle(
    'agentSession:prompt',
    async (
      _event,
      {
        sessionId,
        message,
        images,
      }: {
        sessionId: string;
        message: string;
        images?: Array<{ data: string; mimeType: string }>;
      }
    ) => {
      try {
        agentSessionService.sendMessage(sessionId, message, images);
        return { ok: true };
      } catch (err) {
        const message2 = err instanceof Error ? err.message : String(err);
        log.error('[agentSessionIpc] prompt error:', err);
        return { ok: false, error: message2 };
      }
    }
  );

  ipcMain.handle('agentSession:abort', async (_event, { sessionId }: { sessionId: string }) => {
    try {
      agentSessionService.abortSession(sessionId);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('[agentSessionIpc] abort error:', err);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('agentSession:destroy', async (_event, { sessionId }: { sessionId: string }) => {
    try {
      agentSessionService.destroySession(sessionId);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('[agentSessionIpc] destroy error:', err);
      return { ok: false, error: message };
    }
  });
}
