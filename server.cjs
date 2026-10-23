try {
  const handler = require("./lib/server.cjs");
  module.exports = handler;
  module.exports.handler = handler;
  if (require.main === module) {
    const http = require("http");
    const PORT = Number(process.env.PORT || process.env.OM_PORT) || 3000;
    http.createServer(handler).listen(PORT, function () {
      console.log("Open Motion server -> http://localhost:" + PORT + "/");
    });
  }
} catch (e) {
  console.error(e);
  module.exports = function (req, res) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Server error");
  };
}
