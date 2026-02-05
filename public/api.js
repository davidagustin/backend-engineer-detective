/**
 * API Client - handles all backend communication
 */

const API_BASE = '/api';

/**
 * Fetch all cases
 */
export async function fetchCases() {
  const response = await fetch(`${API_BASE}/cases`);
  if (!response.ok) {
    throw new Error('Failed to fetch cases');
  }
  const data = await response.json();
  return data.cases;
}

/**
 * Fetch a specific case with clues
 */
export async function fetchCase(caseId, cluesRevealed = 2) {
  const response = await fetch(`${API_BASE}/cases/${caseId}?clues=${cluesRevealed}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Case not found');
    }
    throw new Error('Failed to fetch case');
  }
  const data = await response.json();
  return data.case;
}

/**
 * Check a diagnosis attempt
 */
export async function checkDiagnosis(caseId, diagnosis, attemptCount, cluesRevealed) {
  const response = await fetch(`${API_BASE}/cases/${caseId}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diagnosis, attemptCount, cluesRevealed }),
  });
  if (!response.ok) {
    throw new Error('Failed to check diagnosis');
  }
  return response.json();
}

/**
 * Get the solution for a case
 */
export async function fetchSolution(caseId) {
  const response = await fetch(`${API_BASE}/cases/${caseId}/solution`);
  if (!response.ok) {
    throw new Error('Failed to fetch solution');
  }
  const data = await response.json();
  return data.solution;
}

/**
 * Send a chat message and get streaming response
 * @param {Array} messages - Chat history
 * @param {Object} caseContext - Optional case context
 * @param {Function} onChunk - Callback for each text chunk
 * @param {Function} onComplete - Callback when complete
 * @param {Function} onError - Callback on error
 */
export async function sendChatMessage(messages, caseContext, onChunk, onComplete, onError) {
  try {
    const response = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, caseContext }),
    });

    if (!response.ok) {
      throw new Error('Chat request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(data);

            // Handle Workers AI format
            if (parsed.response) {
              fullResponse += parsed.response;
              onChunk(parsed.response);
            }
            // Handle OpenAI format
            else if (parsed.choices?.[0]?.delta?.content) {
              const content = parsed.choices[0].delta.content;
              fullResponse += content;
              onChunk(content);
            }
          } catch (e) {
            // Ignore parse errors for incomplete JSON
          }
        }
      }
    }

    onComplete(fullResponse);
  } catch (error) {
    onError(error);
  }
}
