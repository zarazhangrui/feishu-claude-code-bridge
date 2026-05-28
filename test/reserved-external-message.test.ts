import { describe, expect, it } from 'vitest';
import {
  classifyReservedExternalMessage,
  isReservedExternalMessage,
} from '../src/bot/reserved-external-message';

describe('reserved external message classifier', () => {
  it('reserves external study start commands', () => {
    expect(classifyReservedExternalMessage('/study topic: memory review')).toBe('external-study');
    expect(classifyReservedExternalMessage('please /study topic: memory review')).toBe(
      'external-study',
    );
    expect(isReservedExternalMessage('/study')).toBe(true);
  });

  it('reserves external stop-study commands before ordinary /stop handling', () => {
    expect(classifyReservedExternalMessage('/stop study')).toBe('external-stop-study');
    expect(classifyReservedExternalMessage('please /stop study now')).toBe('external-stop-study');
  });

  it('reserves common external transcript markers', () => {
    expect(classifyReservedExternalMessage('[study-room:room-1] @Claude here is my note')).toBe(
      'external-marker',
    );
    expect(classifyReservedExternalMessage('[orchestrator:run-1] @Claude note')).toBe(
      'external-marker',
    );
  });

  it('does not reserve unrelated commands or prose', () => {
    expect(isReservedExternalMessage('/status')).toBe(false);
    expect(isReservedExternalMessage('/stop')).toBe(false);
    expect(isReservedExternalMessage('Can you study this file?')).toBe(false);
    expect(isReservedExternalMessage('/studying')).toBe(false);
  });
});
