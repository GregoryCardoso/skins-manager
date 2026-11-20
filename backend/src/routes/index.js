const { Router } = require('express');
const itemRoutes = require('./itemRoutes');
const storeRoutes = require('./storeRoutes');
const settingsRoutes = require('./settingsRoutes');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: req.app.locals.now().toISOString() } });
});

router.use('/items', itemRoutes);
router.use('/stores', storeRoutes);
router.use('/settings', settingsRoutes);

module.exports = router;
