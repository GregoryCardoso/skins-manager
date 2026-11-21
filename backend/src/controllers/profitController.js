const profitService = require('../services/profitService');

function summary(req, res) {
  res.json({ success: true, data: profitService.getProfitSummary({ now: req.app.locals.now() }) });
}

module.exports = { summary };
