// models/SmartContract.js
const mongoose = require('mongoose');

const smartContractSchema = new mongoose.Schema({
  structureId: {
    type: String,
    trim: true,
    index: true
  },
  contractType: {
    type: String,
    required: [true, 'Contract type is required'],
    enum: ['ERC3643', 'ERC20', 'ERC721', 'ERC1155', 'OTHER'],
    default: 'ERC3643',
    index: true
  },
  deploymentStatus: {
    type: String,
    required: [true, 'Deployment status is required'],
    enum: ['pending', 'deploying', 'deployed', 'failed'],
    default: 'pending',
    index: true
  },
  complianceRegistryAddress: {
    type: String,
    trim: true
  },
  contractAddress: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  factoryAddress: {
    type: String,
    trim: true
  },
  identityRegistryAddress: {
    type: String,
    trim: true
  },
  transactionHash: {
    type: String,
    trim: true,
    index: true
  },
  network: {
    type: String,
    trim: true,
    default: 'polygon',
    index: true
  },
  company: {
    type: String,
    required: [true, 'Company is required'],
    trim: true
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    trim: true,
    uppercase: true,
    default: 'USD'
  },
  maxTokens: {
    type: Number,
    required: [true, 'Max tokens is required'],
    min: [0, 'Max tokens must be positive']
  },
  mintedTokens: {
    type: String,
    trim: true,
    default: '0'
  },
  projectName: {
    type: String,
    required: [true, 'Project name is required'],
    trim: true
  },
  tokenName: {
    type: String,
    required: [true, 'Token name is required'],
    trim: true
  },
  tokenSymbol: {
    type: String,
    required: [true, 'Token symbol is required'],
    trim: true,
    uppercase: true
  },
  tokenValue: {
    type: String,
    required: [true, 'Token value is required'],
    trim: true
  },
  deployedBy: {
    type: String,
    index: true
  },
  deploymentError: {
    type: String,
    trim: true
  },
  deploymentResponse: {
    type: mongoose.Schema.Types.Mixed
  },
  operatingAgreementHash: {
    type: String,
    trim: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Index for efficient queries
smartContractSchema.index({ contractAddress: 1 });
smartContractSchema.index({ deploymentStatus: 1, createdAt: -1 });
smartContractSchema.index({ deployedBy: 1, deploymentStatus: 1 });

// Static method to find by contract address
smartContractSchema.statics.findByContractAddress = function(contractAddress) {
  return this.findOne({ contractAddress: contractAddress.trim() });
};

// Static method to find by company
smartContractSchema.statics.findByCompany = function(company) {
  return this.find({ company: { $regex: company, $options: 'i' } });
};

// Static method to find by token symbol
smartContractSchema.statics.findByTokenSymbol = function(tokenSymbol) {
  return this.find({ tokenSymbol: tokenSymbol.toUpperCase() });
};

// Static method to find by deployment status
smartContractSchema.statics.findByDeploymentStatus = function(status) {
  return this.find({ deploymentStatus: status }).sort({ createdAt: -1 });
};

// Static method to find by deployed user
smartContractSchema.statics.findByDeployedUser = function(userId) {
  return this.find({ deployedBy: userId }).sort({ createdAt: -1 });
};

// Static method to find by contract type
smartContractSchema.statics.findByContractType = function(contractType) {
  return this.find({ contractType }).sort({ createdAt: -1 });
};

// Instance method to update minted tokens
smartContractSchema.methods.updateMintedTokens = function(amount) {
  this.mintedTokens = amount.toString();
  return this.save();
};

// Instance method to get minting progress
smartContractSchema.methods.getMintingProgress = function() {
  const minted = parseInt(this.mintedTokens, 10);
  const max = this.maxTokens;
  const percentage = max > 0 ? (minted / max) * 100 : 0;

  return {
    mintedTokens: minted,
    maxTokens: max,
    remainingTokens: max - minted,
    progressPercentage: percentage.toFixed(2),
    isFullyMinted: minted >= max
  };
};

// Instance method to check if more tokens can be minted
smartContractSchema.methods.canMintMore = function() {
  const minted = parseInt(this.mintedTokens, 10);
  return minted < this.maxTokens;
};

// Instance method to mark as deployed
smartContractSchema.methods.markAsDeployed = function(deploymentData) {
  this.deploymentStatus = 'deployed';
  if (deploymentData) {
    if (deploymentData.contractAddress) this.contractAddress = deploymentData.contractAddress;
    if (deploymentData.transactionHash) this.transactionHash = deploymentData.transactionHash;
    if (deploymentData.complianceRegistryAddress) this.complianceRegistryAddress = deploymentData.complianceRegistryAddress;
    if (deploymentData.factoryAddress) this.factoryAddress = deploymentData.factoryAddress;
    if (deploymentData.identityRegistryAddress) this.identityRegistryAddress = deploymentData.identityRegistryAddress;
    this.deploymentResponse = deploymentData;
  }
  return this.save();
};

// Instance method to mark as failed
smartContractSchema.methods.markAsFailed = function(error) {
  this.deploymentStatus = 'failed';
  this.deploymentError = error;
  return this.save();
};

// Instance method to mark as deploying
smartContractSchema.methods.markAsDeploying = function() {
  this.deploymentStatus = 'deploying';
  return this.save();
};

// Virtual for checking if contract is fully minted
smartContractSchema.virtual('isFullyMinted').get(function() {
  const minted = parseInt(this.mintedTokens, 10);
  return minted >= this.maxTokens;
});

// Ensure virtuals are included when converting to JSON
smartContractSchema.set('toJSON', { virtuals: true });
smartContractSchema.set('toObject', { virtuals: true });

const SmartContract = mongoose.model('SmartContract', smartContractSchema);

module.exports = SmartContract;
