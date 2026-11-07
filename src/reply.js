module.exports = function privateReply({ cid }, msg, text, {
  embed, pages, components, update,
} = {}) {
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
  if (components) data.discord_components = components;
  if (update) data.discord_update = true;
  if (Object.keys(data).length) reply.data = data;
  return reply;
};
