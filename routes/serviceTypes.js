const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const serviceTypeService = require('../services/serviceTypeService');
const asyncHandler = require('../utils/asyncHandler');
const { body, param, validationResult } = require('express-validator');

const validateServiceType = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ max: 100 }),
  body('value')
    .optional()
    .trim()
    .custom((value) => {
      if (value && value.length > 0 && !/^[a-z_]+$/.test(value)) {
        throw new Error(
          'Value must contain only lowercase letters and underscores'
        );
      }
      return true;
    }),
  body('description').optional().isLength({ max: 500 }),
  body('isActive').optional().isBoolean(),
  body('displayOrder').optional().isInt({ min: 0 }),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.get(
  '/',
  authenticateToken,
  authorize('manage_service_types'),
  asyncHandler(async (req, res) => {
    const filters = {
      isActive:
        req.query.isActive === 'true'
          ? true
          : req.query.isActive === 'false'
            ? false
            : undefined,
      search: req.query.search,
      sort: req.query.sort,
    };

    const serviceTypes = await serviceTypeService.getAllServiceTypes(filters);
    res.json(serviceTypes);
  })
);

router.get(
  '/active',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const serviceTypes = await serviceTypeService.getActiveServiceTypes();
    res.json(serviceTypes);
  })
);

router.get(
  '/stats',
  authenticateToken,
  authorize('manage_service_types'),
  asyncHandler(async (req, res) => {
    const stats = await serviceTypeService.getServiceTypeStats();
    res.json(stats);
  })
);

router.get(
  '/:id',
  authenticateToken,
  authorize('manage_service_types'),
  param('id').isMongoId(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const serviceType = await serviceTypeService.getServiceTypeById(
      req.params.id
    );
    res.json(serviceType);
  })
);

router.post(
  '/',
  authenticateToken,
  authorize('manage_service_types'),
  validateServiceType,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const serviceType = await serviceTypeService.createServiceType(
      req.body,
      req.user.id
    );
    res.status(201).json(serviceType);
  })
);

router.put(
  '/:id',
  authenticateToken,
  authorize('manage_service_types'),
  param('id').isMongoId(),
  validateServiceType,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const serviceType = await serviceTypeService.updateServiceType(
      req.params.id,
      req.body,
      req.user.id
    );
    res.json(serviceType);
  })
);

router.delete(
  '/:id',
  authenticateToken,
  authorize('manage_service_types'),
  param('id').isMongoId(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    await serviceTypeService.deleteServiceType(req.params.id, req.user.id);
    res.status(204).send();
  })
);

router.put(
  '/reorder',
  authenticateToken,
  authorize('manage_service_types'),
  body('orderedIds').isArray().notEmpty(),
  body('orderedIds.*').isMongoId(),
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const serviceTypes = await serviceTypeService.reorderServiceTypes(
      req.body.orderedIds,
      req.user.id
    );
    res.json(serviceTypes);
  })
);

module.exports = router;
