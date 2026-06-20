/**
 * Message normalization utilities.
 * Converts NormalizedMessage[] from the session store into ChatMessage[] for the UI.
 */

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import type { ChatMessage, SubagentChildTool } from '../types/types';
import { decodeHtmlEntities, unescapeWithMathProtection, formatUsageLimitText } from '../utils/chatFormatting';

function formatToolResultContent(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const toolUseErrorMatch = /^<tool_use_error>([\s\S]*)<\/tool_use_error>$/.exec(text.trim());
  return toolUseErrorMatch ? toolUseErrorMatch[1] : text;
}

/**
 * Convert NormalizedMessage[] from the session store into ChatMessage[]
 * that the existing UI components expect.
 *
 * Truly internal/system content is already filtered server-side. Some Claude
 * transcript artifacts such as local slash commands and compact summaries are
 * intentionally preserved and annotated so they can render like normal chat.
 */
export function normalizedToChatMessages(messages: NormalizedMessage[]): ChatMessage[] {
  const converted: ChatMessage[] = [];

  // First pass: collect tool results for attachment
  const toolResultMap = new Map<string, NormalizedMessage>();
  const toolUseIds = new Set<string>();
  for (const msg of messages) {
    if (msg.kind === 'tool_use' && msg.toolId) {
      toolUseIds.add(msg.toolId);
    }

    if (msg.kind === 'tool_result' && msg.toolId) {
      toolResultMap.set(msg.toolId, msg);
    }
  }

  for (const msg of messages) {
    const sharedMetadata = {
      id: msg.id,
      displayText: msg.displayText,
      commandName: msg.commandName,
      commandMessage: msg.commandMessage,
      commandArgs: msg.commandArgs,
      isLocalCommand: msg.isLocalCommand,
      isLocalCommandStdout: msg.isLocalCommandStdout,
      isCompactSummary: msg.isCompactSummary,
    };

    switch (msg.kind) {
      case 'text': {
        const content = msg.content || '';
        if (!content.trim()) continue;

        if (msg.role === 'user') {
          // Parse task notifications
          const taskNotifRegex = /<task-notification>\s*<task-id>[^<]*<\/task-id>\s*<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g;
          const taskNotifMatch = taskNotifRegex.exec(content);
          if (taskNotifMatch) {
            converted.push({
              type: 'assistant',
              content: taskNotifMatch[2]?.trim() || 'Background task finished',
              timestamp: msg.timestamp,
              isTaskNotification: true,
              taskStatus: taskNotifMatch[1]?.trim() || 'completed',
              ...sharedMetadata,
            });
          } else {
            // Detect skill/system injected messages (long content with skill markers)
            // or context file injections (claude.md, memory.md, etc.)
            const isSkillContent = content.length > 500 && (
              content.includes('Base directory for this skill:') ||
              content.includes('AUTO-GENERATED from SKILL') ||
              content.includes('## Preamble') ||
              content.includes('.claude/skills/') ||
              content.includes('_PROACTIVE=') ||
              content.includes('gstack-config') ||
              content.includes('claude.md') ||
              content.includes('memory.md') ||
              content.includes('CLAUDE.md') ||
              content.includes('AGENTS.md') ||
              /^#\s+(Project|Context|Memory|Instructions)/m.test(content)
            );
            if (isSkillContent) {
              converted.push({
                type: 'assistant',
                content,
                timestamp: msg.timestamp,
                isSkillContent: true,
                ...sharedMetadata,
              });
            } else {
              // Check if content is a JSON array with image content blocks (API format)
              let userText = content;
              let parsedImages: { data: string; name: string }[] | undefined = msg.images?.map(d => ({ data: d, name: '' }));
              
              // Strip server-appended image paths section
              const pathIdx = userText.indexOf('[Images provided at the following paths:]');
              if (pathIdx > 0) {
                userText = userText.slice(0, pathIdx).trim();
              }

              const trimmed = content.trim();
              if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                  const parsed = JSON.parse(trimmed);
                  if (Array.isArray(parsed) && parsed.some((b: any) => b?.type === 'image' || b?.type === 'text')) {
                    userText = parsed
                      .filter((b: any) => b?.type === 'text')
                      .map((b: any) => b.text || '')
                      .join('\n');
                    const imgBlocks = parsed.filter((b: any) => b?.type === 'image' && b?.source?.data);
                    if (imgBlocks.length > 0) {
                      parsedImages = imgBlocks.map((b: any) => ({
                        data: b.source.media_type
                          ? `data:${b.source.media_type};base64,${b.source.data}`
                          : `data:image/png;base64,${b.source.data}`,
                        name: '',
                      }));
                    }
                  }
                } catch {
                  // Not valid JSON, use content as-is
                }
              }

              converted.push({
                type: 'user',
                content: unescapeWithMathProtection(decodeHtmlEntities(userText)),
                images: parsedImages,
                timestamp: msg.timestamp,
                ...sharedMetadata,
              });
            }
          }
        } else {
          let text = decodeHtmlEntities(content);
          text = unescapeWithMathProtection(text);
          text = formatUsageLimitText(text);
          converted.push({
            type: 'assistant',
            content: text,
            timestamp: msg.timestamp,
            ...sharedMetadata,
          });
        }
        break;
      }

      case 'tool_use': {
        const tr = msg.toolResult || (msg.toolId ? toolResultMap.get(msg.toolId) : null);
        const isSubagentContainer = msg.toolName === 'Task';

        // Build child tools from subagentTools
        const childTools: SubagentChildTool[] = [];
        if (isSubagentContainer && msg.subagentTools && Array.isArray(msg.subagentTools)) {
          for (const tool of msg.subagentTools as any[]) {
            childTools.push({
              toolId: tool.toolId,
              toolName: tool.toolName,
              toolInput: tool.toolInput,
              toolResult: tool.toolResult || null,
              timestamp: new Date(tool.timestamp || Date.now()),
            });
          }
        }

        const toolResult = tr
          ? {
              content: formatToolResultContent(tr.content),
              isError: Boolean(tr.isError),
              toolUseResult: (tr as any).toolUseResult,
            }
          : null;

        converted.push({
          type: 'assistant',
          content: '',
          timestamp: msg.timestamp,
          isToolUse: true,
          toolName: msg.toolName,
          toolInput: typeof msg.toolInput === 'string' ? msg.toolInput : JSON.stringify(msg.toolInput ?? '', null, 2),
          toolId: msg.toolId,
          toolResult,
          isSubagentContainer,
          subagentState: isSubagentContainer
            ? {
                childTools,
                currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                isComplete: Boolean(toolResult),
              }
            : undefined,
          ...sharedMetadata,
        });
        break;
      }

      case 'thinking':
        if (msg.content?.trim()) {
          converted.push({
            type: 'assistant',
            content: unescapeWithMathProtection(msg.content),
            timestamp: msg.timestamp,
            isThinking: true,
            ...sharedMetadata,
          });
        }
        break;

      case 'error':
        converted.push({
          type: 'error',
          content: msg.content || 'Unknown error',
          timestamp: msg.timestamp,
          ...sharedMetadata,
        });
        break;

      case 'interactive_prompt':
        converted.push({
          type: 'assistant',
          content: msg.content || '',
          timestamp: msg.timestamp,
          isInteractivePrompt: true,
          ...sharedMetadata,
        });
        break;

      case 'task_notification':
        converted.push({
          type: 'assistant',
          content: msg.summary || 'Background task update',
          timestamp: msg.timestamp,
          isTaskNotification: true,
          taskStatus: msg.status || 'completed',
          ...sharedMetadata,
        });
        break;

      case 'stream_delta':
        if (msg.content) {
          converted.push({
            type: 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
            isStreaming: true,
            ...sharedMetadata,
          });
        }
        break;

      // stream_end, complete, status, permission_*, session_created
      // are control events — not rendered as messages
      case 'stream_end':
      case 'complete':
      case 'status':
      case 'permission_request':
      case 'permission_cancelled':
      case 'session_created':
        // Skip — these are handled by useChatRealtimeHandlers
        break;

      // tool_result is handled via attachment to tool_use above
      case 'tool_result': {
        if (msg.toolId && toolUseIds.has(msg.toolId)) {
          break;
        }

        const content = formatToolResultContent(msg.content || '');
        if (!content.trim()) {
          break;
        }

        converted.push({
          type: msg.isError ? 'error' : 'assistant',
          content,
          timestamp: msg.timestamp,
          toolId: msg.toolId,
          ...sharedMetadata,
        });
        break;
      }

      default:
        break;
    }
  }

  return converted;
}
