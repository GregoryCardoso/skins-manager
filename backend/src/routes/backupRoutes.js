const { Router } = require('express');
const controller = require('../controllers/backupController');
const { requireOctetStream, parseImportBody, validateOpenFolderBody } = require('../middlewares/backupValidators');

const router = Router();

router.get('/info', controller.info);
router.post('/open-folder', validateOpenFolderBody, controller.openFolder);
router.get('/export', controller.exportBackup);
router.post('/import', requireOctetStream, parseImportBody, controller.importBackup);

module.exports = router;
