-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `passwordHash` VARCHAR(100) NULL,
    `role` ENUM('ADMIN', 'PREVENTISTA', 'COMERCIO') NOT NULL,
    `status` ENUM('ACTIVO', 'SUSPENDIDO') NOT NULL DEFAULT 'ACTIVO',
    `image` VARCHAR(500) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_role_status_idx`(`role`, `status`),
    INDEX `User_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `providerAccountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Account_userId_idx`(`userId`),
    UNIQUE INDEX `Account_provider_providerAccountId_key`(`provider`, `providerAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `PasswordResetToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Business` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(160) NOT NULL,
    `tradeName` VARCHAR(160) NOT NULL,
    `cuit` VARCHAR(11) NOT NULL,
    `ivaCondition` ENUM('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL') NOT NULL,
    `street` VARCHAR(160) NOT NULL,
    `streetNumber` VARCHAR(20) NOT NULL,
    `floorApt` VARCHAR(40) NULL,
    `postalCode` VARCHAR(10) NULL,
    `provinceId` INTEGER NOT NULL,
    `localityId` INTEGER NOT NULL,
    `phone` VARCHAR(40) NULL,
    `description` TEXT NULL,
    `distributorStatus` ENUM('PENDIENTE', 'APROBADO', 'RECHAZADO') NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(191) NULL,
    `rejectionReason` VARCHAR(500) NULL,
    `commissionBps` INTEGER NULL,
    `ratingAvg` DOUBLE NULL,
    `ratingCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Business_userId_key`(`userId`),
    UNIQUE INDEX `Business_cuit_key`(`cuit`),
    INDEX `Business_distributorStatus_idx`(`distributorStatus`),
    INDEX `Business_provinceId_localityId_idx`(`provinceId`, `localityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Province` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,

    UNIQUE INDEX `Province_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Locality` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `provinceId` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Locality_provinceId_name_key`(`provinceId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DistributorCoverage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` VARCHAR(191) NOT NULL,
    `provinceId` INTEGER NOT NULL,
    `localityId` INTEGER NULL,

    INDEX `DistributorCoverage_businessId_idx`(`businessId`),
    INDEX `DistributorCoverage_provinceId_localityId_idx`(`provinceId`, `localityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `globalCommissionBps` INTEGER NOT NULL DEFAULT 800,
    `commissionMode` ENUM('DESCONTAR_AL_PREVENTISTA', 'SUMAR_AL_COMERCIO') NOT NULL DEFAULT 'DESCONTAR_AL_PREVENTISTA',
    `catalogCommissionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `paymentWindowHours` INTEGER NOT NULL DEFAULT 48,
    `unpaidRule` ENUM('REABRIR', 'CERRAR_CON_PAGADO') NOT NULL DEFAULT 'REABRIR',
    `reopenExtensionHours` INTEGER NOT NULL DEFAULT 48,
    `expiredDecisionHours` INTEGER NOT NULL DEFAULT 48,
    `poolApprovalRequired` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommissionChange` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(20) NOT NULL,
    `targetId` VARCHAR(40) NULL,
    `targetLabel` VARCHAR(200) NOT NULL,
    `oldValue` VARCHAR(60) NULL,
    `newValue` VARCHAR(60) NULL,
    `changedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CommissionChange_createdAt_idx`(`createdAt`),
    INDEX `CommissionChange_scope_targetId_idx`(`scope`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `icon` VARCHAR(40) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `commissionBps` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Category_name_key`(`name`),
    UNIQUE INDEX `Category_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `brand` VARCHAR(80) NULL,
    `description` TEXT NULL,
    `sku` VARCHAR(60) NOT NULL,
    `ean` VARCHAR(14) NULL,
    `saleUnit` ENUM('UNIDAD', 'BULTO') NOT NULL DEFAULT 'UNIDAD',
    `unitsPerPack` INTEGER NOT NULL DEFAULT 1,
    `priceCents` BIGINT NOT NULL,
    `retailPriceCents` BIGINT NULL,
    `minOrderQty` INTEGER NOT NULL DEFAULT 1,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Product_categoryId_active_idx`(`categoryId`, `active`),
    INDEX `Product_distributorId_active_idx`(`distributorId`, `active`),
    INDEX `Product_ean_idx`(`ean`),
    UNIQUE INDEX `Product_distributorId_sku_key`(`distributorId`, `sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductImage` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(200) NOT NULL,
    `thumbKey` VARCHAR(200) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductImage_productId_sortOrder_idx`(`productId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Pool` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('BORRADOR', 'PENDIENTE_APROBACION', 'ABIERTO', 'COMPLETO', 'CERRADO_PAGADO', 'EN_ENTREGA', 'ENTREGADO', 'VENCIDO_SIN_COMPLETAR', 'CANCELADO') NOT NULL DEFAULT 'BORRADOR',
    `saleUnit` ENUM('UNIDAD', 'BULTO') NOT NULL DEFAULT 'UNIDAD',
    `priceInputCents` BIGINT NOT NULL,
    `unitPriceCents` BIGINT NOT NULL,
    `commissionUnitCents` BIGINT NOT NULL,
    `netUnitCents` BIGINT NOT NULL,
    `retailUnitPriceCents` BIGINT NOT NULL,
    `commissionBps` INTEGER NOT NULL,
    `commissionMode` ENUM('DESCONTAR_AL_PREVENTISTA', 'SUMAR_AL_COMERCIO') NOT NULL,
    `commissionSource` ENUM('GLOBAL', 'CATEGORIA', 'PREVENTISTA') NOT NULL,
    `commissionFrozenAt` DATETIME(3) NULL,
    `totalUnits` INTEGER NOT NULL,
    `minUnitsToClose` INTEGER NOT NULL,
    `minPerCommerce` INTEGER NOT NULL DEFAULT 1,
    `maxPerCommerce` INTEGER NOT NULL,
    `committedUnits` INTEGER NOT NULL DEFAULT 0,
    `paidUnits` INTEGER NOT NULL DEFAULT 0,
    `closeOnMinimum` BOOLEAN NOT NULL DEFAULT true,
    `paymentWindowHours` INTEGER NOT NULL DEFAULT 48,
    `unpaidRule` ENUM('REABRIR', 'CERRAR_CON_PAGADO') NOT NULL DEFAULT 'REABRIR',
    `deadlineAt` DATETIME(3) NOT NULL,
    `originalDeadlineAt` DATETIME(3) NULL,
    `extendedOnce` BOOLEAN NOT NULL DEFAULT false,
    `acceptedBelowMinimum` BOOLEAN NOT NULL DEFAULT false,
    `estimatedDeliveryAt` DATETIME(3) NULL,
    `scheduledDeliveryAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `expiredAt` DATETIME(3) NULL,
    `decisionDeadlineAt` DATETIME(3) NULL,
    `finalizedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(500) NULL,
    `reviewNote` VARCHAR(500) NULL,
    `notified80` BOOLEAN NOT NULL DEFAULT false,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Pool_status_deadlineAt_idx`(`status`, `deadlineAt`),
    INDEX `Pool_status_featured_idx`(`status`, `featured`),
    INDEX `Pool_distributorId_status_idx`(`distributorId`, `status`),
    INDEX `Pool_categoryId_status_idx`(`categoryId`, `status`),
    INDEX `Pool_status_decisionDeadlineAt_idx`(`status`, `decisionDeadlineAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PoolZone` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poolId` VARCHAR(191) NOT NULL,
    `provinceId` INTEGER NOT NULL,
    `localityId` INTEGER NULL,

    INDEX `PoolZone_poolId_idx`(`poolId`),
    INDEX `PoolZone_provinceId_localityId_idx`(`provinceId`, `localityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Participation` (
    `id` VARCHAR(191) NOT NULL,
    `poolId` VARCHAR(191) NOT NULL,
    `commerceId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPriceCents` BIGINT NOT NULL,
    `totalCents` BIGINT NOT NULL,
    `commissionCents` BIGINT NOT NULL,
    `netCents` BIGINT NOT NULL,
    `status` ENUM('COMPROMETIDA', 'PENDIENTE_PAGO', 'PAGADA', 'ENTREGADA', 'RETIRADA', 'LIBERADA', 'CANCELADA') NOT NULL DEFAULT 'COMPROMETIDA',
    `withdrawnAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Participation_commerceId_status_idx`(`commerceId`, `status`),
    INDEX `Participation_poolId_status_idx`(`poolId`, `status`),
    UNIQUE INDEX `Participation_poolId_commerceId_key`(`poolId`, `commerceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `commerceId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDIENTE_PAGO', 'PAGADO', 'EN_ENTREGA', 'ENTREGADO', 'CANCELADO') NOT NULL DEFAULT 'PENDIENTE_PAGO',
    `subtotalCents` BIGINT NOT NULL,
    `commissionCents` BIGINT NOT NULL,
    `netCents` BIGINT NOT NULL,
    `commissionBps` INTEGER NOT NULL,
    `notes` VARCHAR(500) NULL,
    `scheduledDeliveryAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_number_key`(`number`),
    INDEX `Order_commerceId_status_idx`(`commerceId`, `status`),
    INDEX `Order_distributorId_status_idx`(`distributorId`, `status`),
    INDEX `Order_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `sku` VARCHAR(60) NOT NULL,
    `saleUnit` ENUM('UNIDAD', 'BULTO') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPriceCents` BIGINT NOT NULL,
    `totalCents` BIGINT NOT NULL,
    `commissionCents` BIGINT NOT NULL,
    `netCents` BIGINT NOT NULL,

    INDEX `OrderItem_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `kind` ENUM('POOL', 'PEDIDO') NOT NULL,
    `commerceId` VARCHAR(191) NOT NULL,
    `participationId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `amountCents` BIGINT NOT NULL,
    `commissionCents` BIGINT NOT NULL,
    `netCents` BIGINT NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `status` ENUM('PENDIENTE', 'EN_PROCESO', 'APROBADO', 'VENCIDO', 'CANCELADO', 'REINTEGRADO') NOT NULL DEFAULT 'PENDIENTE',
    `providerPreferenceId` VARCHAR(120) NULL,
    `providerPaymentId` VARCHAR(120) NULL,
    `providerStatus` VARCHAR(60) NULL,
    `checkoutUrl` TEXT NULL,
    `dueAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `refundedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Payment_status_dueAt_idx`(`status`, `dueAt`),
    INDEX `Payment_participationId_idx`(`participationId`),
    INDEX `Payment_orderId_idx`(`orderId`),
    INDEX `Payment_commerceId_status_idx`(`commerceId`, `status`),
    INDEX `Payment_status_paidAt_idx`(`status`, `paidAt`),
    UNIQUE INDEX `Payment_provider_providerPaymentId_key`(`provider`, `providerPaymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(60) NULL,
    `resourceId` VARCHAR(120) NULL,
    `payload` TEXT NOT NULL,
    `result` VARCHAR(255) NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebhookEvent_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `WebhookEvent_provider_eventKey_key`(`provider`, `eventKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Settlement` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `sourceType` ENUM('POOL', 'PEDIDO') NOT NULL,
    `poolId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `grossCents` BIGINT NOT NULL,
    `commissionCents` BIGINT NOT NULL,
    `netCents` BIGINT NOT NULL,
    `status` ENUM('PENDIENTE', 'LIQUIDADO') NOT NULL DEFAULT 'PENDIENTE',
    `reference` VARCHAR(120) NULL,
    `notes` VARCHAR(500) NULL,
    `paidOutAt` DATETIME(3) NULL,
    `paidOutById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Settlement_poolId_key`(`poolId`),
    UNIQUE INDEX `Settlement_orderId_key`(`orderId`),
    INDEX `Settlement_distributorId_status_idx`(`distributorId`, `status`),
    INDEX `Settlement_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Rating` (
    `id` VARCHAR(191) NOT NULL,
    `commerceId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `poolId` VARCHAR(191) NULL,
    `participationId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `stars` INTEGER NOT NULL,
    `comment` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Rating_participationId_key`(`participationId`),
    UNIQUE INDEX `Rating_orderId_key`(`orderId`),
    INDEX `Rating_distributorId_createdAt_idx`(`distributorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Dispute` (
    `id` VARCHAR(191) NOT NULL,
    `openedById` VARCHAR(191) NOT NULL,
    `commerceId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `poolId` VARCHAR(191) NULL,
    `participationId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `reason` VARCHAR(60) NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('ABIERTA', 'EN_REVISION', 'RESUELTA', 'RECHAZADA') NOT NULL DEFAULT 'ABIERTA',
    `distributorResponse` TEXT NULL,
    `resolution` TEXT NULL,
    `resolvedById` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Dispute_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Dispute_distributorId_idx`(`distributorId`),
    INDEX `Dispute_commerceId_idx`(`commerceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `link` VARCHAR(300) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Job` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `payload` TEXT NOT NULL,
    `status` ENUM('PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `lastError` TEXT NULL,
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(60) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Job_status_runAt_idx`(`status`, `runAt`),
    INDEX `Job_type_status_idx`(`type`, `status`),
    INDEX `Job_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(20) NULL,
    `action` VARCHAR(60) NOT NULL,
    `entityType` VARCHAR(40) NOT NULL,
    `entityId` VARCHAR(40) NOT NULL,
    `summary` VARCHAR(500) NULL,
    `before` TEXT NULL,
    `after` TEXT NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemStatus` (
    `key` VARCHAR(60) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Account` ADD CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Business` ADD CONSTRAINT `Business_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Business` ADD CONSTRAINT `Business_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Business` ADD CONSTRAINT `Business_provinceId_fkey` FOREIGN KEY (`provinceId`) REFERENCES `Province`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Business` ADD CONSTRAINT `Business_localityId_fkey` FOREIGN KEY (`localityId`) REFERENCES `Locality`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Locality` ADD CONSTRAINT `Locality_provinceId_fkey` FOREIGN KEY (`provinceId`) REFERENCES `Province`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCoverage` ADD CONSTRAINT `DistributorCoverage_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCoverage` ADD CONSTRAINT `DistributorCoverage_provinceId_fkey` FOREIGN KEY (`provinceId`) REFERENCES `Province`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DistributorCoverage` ADD CONSTRAINT `DistributorCoverage_localityId_fkey` FOREIGN KEY (`localityId`) REFERENCES `Locality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformConfig` ADD CONSTRAINT `PlatformConfig_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommissionChange` ADD CONSTRAINT `CommissionChange_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Business`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductImage` ADD CONSTRAINT `ProductImage_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pool` ADD CONSTRAINT `Pool_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pool` ADD CONSTRAINT `Pool_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Pool` ADD CONSTRAINT `Pool_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoolZone` ADD CONSTRAINT `PoolZone_poolId_fkey` FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoolZone` ADD CONSTRAINT `PoolZone_provinceId_fkey` FOREIGN KEY (`provinceId`) REFERENCES `Province`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoolZone` ADD CONSTRAINT `PoolZone_localityId_fkey` FOREIGN KEY (`localityId`) REFERENCES `Locality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Participation` ADD CONSTRAINT `Participation_poolId_fkey` FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Participation` ADD CONSTRAINT `Participation_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_participationId_fkey` FOREIGN KEY (`participationId`) REFERENCES `Participation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_poolId_fkey` FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_paidOutById_fkey` FOREIGN KEY (`paidOutById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_poolId_fkey` FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_participationId_fkey` FOREIGN KEY (`participationId`) REFERENCES `Participation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rating` ADD CONSTRAINT `Rating_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispute` ADD CONSTRAINT `Dispute_openedById_fkey` FOREIGN KEY (`openedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispute` ADD CONSTRAINT `Dispute_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispute` ADD CONSTRAINT `Dispute_commerceId_fkey` FOREIGN KEY (`commerceId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispute` ADD CONSTRAINT `Dispute_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Business`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispute` ADD CONSTRAINT `Dispute_poolId_fkey` FOREIGN KEY (`poolId`) REFERENCES `Pool`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispute` ADD CONSTRAINT `Dispute_participationId_fkey` FOREIGN KEY (`participationId`) REFERENCES `Participation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispute` ADD CONSTRAINT `Dispute_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
