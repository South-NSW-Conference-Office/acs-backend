const ServiceType = require('../models/ServiceType');
const Service = require('../models/Service');
const AppError = require('../utils/appError');

class ServiceTypeService {
  async getAllServiceTypes(filters = {}) {
    const query = { deletedAt: null };

    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } },
      ];
    }

    return await ServiceType.find(query)
      .sort(filters.sort || 'displayOrder name')
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');
  }

  async getActiveServiceTypes() {
    return await ServiceType.findActive();
  }

  async getServiceTypeById(id) {
    const serviceType = await ServiceType.findOne({ _id: id, deletedAt: null })
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName');

    if (!serviceType) {
      throw new AppError('Service type not found', 404);
    }

    return serviceType;
  }

  async getServiceTypeByValue(value) {
    return await ServiceType.findByValue(value);
  }

  async createServiceType(data, userId) {
    const existingType = await ServiceType.findOne({
      value:
        data.value ||
        data.name
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z_]/g, ''),
      deletedAt: null,
    });

    if (existingType) {
      throw new AppError('Service type with this value already exists', 400);
    }

    const maxOrderType = await ServiceType.findOne({}).sort('-displayOrder');
    const nextOrder = maxOrderType ? maxOrderType.displayOrder + 1 : 1;

    const serviceType = new ServiceType({
      ...data,
      displayOrder: data.displayOrder || nextOrder,
      createdBy: userId,
      updatedBy: userId,
    });

    await serviceType.save();
    return serviceType;
  }

  async updateServiceType(id, data, userId) {
    const serviceType = await this.getServiceTypeById(id);

    if (data.value && data.value !== serviceType.value) {
      const existingType = await ServiceType.findOne({
        value: data.value,
        deletedAt: null,
        _id: { $ne: id },
      });

      if (existingType) {
        throw new AppError('Service type with this value already exists', 400);
      }

      const servicesUsingType = await Service.countDocuments({
        type: serviceType.value,
      });
      if (servicesUsingType > 0) {
        throw new AppError(
          'Cannot change value of service type that is in use',
          400
        );
      }
    }

    Object.assign(serviceType, {
      ...data,
      updatedBy: userId,
    });

    await serviceType.save();
    return serviceType;
  }

  async deleteServiceType(id, userId) {
    const serviceType = await this.getServiceTypeById(id);

    const servicesUsingType = await Service.countDocuments({
      type: serviceType.value,
    });
    if (servicesUsingType > 0) {
      throw new AppError(
        `Cannot delete service type that is being used by ${servicesUsingType} service(s)`,
        400
      );
    }

    await serviceType.softDelete(userId);
    return serviceType;
  }

  async reorderServiceTypes(orderedIds, userId) {
    const updates = orderedIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id, deletedAt: null },
        update: {
          displayOrder: index + 1,
          updatedBy: userId,
          updatedAt: new Date(),
        },
      },
    }));

    await ServiceType.bulkWrite(updates);
    return await this.getAllServiceTypes();
  }

  async getServiceTypeStats() {
    const [totalTypes, activeTypes, typesInUse] = await Promise.all([
      ServiceType.countDocuments({ deletedAt: null }),
      ServiceType.countDocuments({ deletedAt: null, isActive: true }),
      Service.aggregate([
        { $group: { _id: '$type' } },
        { $count: 'count' },
      ]).then((result) => result[0]?.count || 0),
    ]);

    return { totalTypes, activeTypes, typesInUse };
  }
}

module.exports = new ServiceTypeService();
