export const roleRegistry = [
  {
    id: 'architect',
    name: 'Architect',
    voiceId: 'af_bella',
    replies: [
      'Keep the transport transient and treat transcript events as the durable product boundary.',
      'This slice is proving turn contracts, not broader agent behavior.',
      'Separate the browser session UI from the orchestration state machine so later agents can slot in cleanly.'
    ]
  },
  {
    id: 'facilitator',
    name: 'Facilitator',
    voiceId: 'af_heart',
    replies: [
      'The useful next step is to capture the decision and make the follow-up explicit.',
      'That sounds actionable. Log the final transcript, attribute the speaker, and return the reply clearly.',
      'This turn is valid when the transcript is clear and the responding role is visible in the UI.'
    ]
  },
  {
    id: 'operator',
    name: 'Operator',
    voiceId: 'af_nova',
    replies: [
      'Track the session id, turn id, and provider metadata or the voice path will be hard to debug later.',
      'A stable slice needs readable failure handling for empty turns and backend disconnects.',
      'Latency only becomes interpretable once capture, transcription, reply generation, and synthesis are separated.'
    ]
  }
];

export function selectMockReply(random = Math.random) {
  const role = roleRegistry[Math.floor(random() * roleRegistry.length)];
  const reply = role.replies[Math.floor(random() * role.replies.length)];
  return { role, reply };
}
