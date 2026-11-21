const { Router } = require('express');
const itemRoutes = require('./itemRoutes');
const storeRoutes = require('./storeRoutes');
const settingsRoutes = require('./settingsRoutes');
const catalogRoutes = require('./catalogRoutes');
const backupRoutes = require('./backupRoutes');
const depositRoutes = require('./depositRoutes');
const withdrawalRoutes = require('./withdrawalRoutes');
const storeBalanceRoutes = require('./storeBalanceRoutes');
const profitRoutes = require('./profitRoutes');

const { APP_NAME, APP_VERSION } = require('../config/appInfo');

const router = Router();

router.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: req.app.locals.now().toISOString(), app: APP_NAME, version: APP_VERSION } });
});

router.use('/items', itemRoutes);
router.use('/stores', storeRoutes);
router.use('/settings', settingsRoutes);
router.use('/catalog', catalogRoutes);
router.use('/backup', backupRoutes);
router.use('/deposits', depositRoutes);
router.use('/withdrawals', withdrawalRoutes);
router.use('/store-balances', storeBalanceRoutes);
router.use('/profit', profitRoutes);

module.exports = router;
