module.exports = function privateReply({ cid }, msg, text, { embed, pages } = {}) {
  const reply = {
    uid: cid,
    target: msg.cid,
    channel: msg.uid,
    text,
    type: 'private',
    timeReceived: Date.now(),
  };
  const data = {};
  if (msg.data && msg.data.interactionId) data.interactionId = msg.data.interactionId;
  if (embed) data.discord_embed = embed;
  if (pages) data.discord_pages = pages;
  if (Object.keys(data).length) reply.data = data;
  return reply;
};
