const { Router } = require('express');
const controller = require('../controllers/backupController');
const { requireOctetStream, parseImportBody } = require('../middlewares/backupValidators');

const router = Router();

router.get('/export', controller.exportBackup);
router.post('/import', requireOctetStream, parseImportBody, controller.importBackup);

module.exports = router;
