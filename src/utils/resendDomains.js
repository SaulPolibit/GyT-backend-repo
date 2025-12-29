/**
 * Resend Domains Utility
 * Handles domain management via Resend API
 *
 * Resend API Documentation: https://resend.com/docs/api-reference/domains
 */

const { Resend } = require('resend');

// Create Resend client lazily to ensure it uses current env variable
// (avoids module caching issues in serverless environments)
function getResendClient() {
  return new Resend(process.env.RESEND_API_KEY);
}

/**
 * Create a new domain in Resend
 * @param {string} domainName - The domain to add (e.g., 'clientfund.com')
 * @param {string} region - Optional region: 'us-east-1' (default), 'eu-west-1', 'sa-east-1'
 * @returns {Promise<Object>} Domain object with DNS records
 */
async function createDomain(domainName, region = 'us-east-1') {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not configured');
  }

  if (!domainName) {
    throw new Error('Domain name is required');
  }

  // Validate domain format (supports subdomains like mail.example.com)
  const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (!domainRegex.test(domainName)) {
    throw new Error('Invalid domain format');
  }

  try {
    const resend = getResendClient();
    const { data, error } = await resend.domains.create({
      name: domainName,
      region: region
    });

    if (error) {
      // Check for specific error types
      if (error.message?.includes('already exists')) {
        throw new Error(`Domain ${domainName} is already registered in Resend`);
      }
      throw new Error(error.message || 'Failed to create domain in Resend');
    }

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      region: data.region,
      records: data.records || [],
      createdAt: data.created_at
    };
  } catch (error) {
    if (error.message?.includes('already exists')) {
      throw error;
    }
    throw new Error(`Failed to create domain: ${error.message}`);
  }
}

/**
 * Get domain details including DNS records
 * @param {string} domainId - The Resend domain ID
 * @returns {Promise<Object>} Domain object with status and records
 */
async function getDomain(domainId) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not configured');
  }

  if (!domainId) {
    throw new Error('Domain ID is required');
  }

  try {
    const resend = getResendClient();
    const { data, error } = await resend.domains.get(domainId);

    if (error) {
      throw new Error(error.message || 'Failed to get domain from Resend');
    }

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      region: data.region,
      records: data.records || [],
      createdAt: data.created_at
    };
  } catch (error) {
    throw new Error(`Failed to get domain: ${error.message}`);
  }
}

/**
 * Verify a domain's DNS records
 * @param {string} domainId - The Resend domain ID
 * @returns {Promise<Object>} Verification result
 */
async function verifyDomain(domainId) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not configured');
  }

  if (!domainId) {
    throw new Error('Domain ID is required');
  }

  try {
    const resend = getResendClient();
    const { data, error } = await resend.domains.verify(domainId);

    if (error) {
      throw new Error(error.message || 'Failed to verify domain');
    }

    return {
      id: data.id,
      name: data.name,
      status: data.status,
      records: data.records || []
    };
  } catch (error) {
    throw new Error(`Failed to verify domain: ${error.message}`);
  }
}

/**
 * List all domains in the Resend account
 * @returns {Promise<Array>} Array of domain objects
 */
async function listDomains() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not configured');
  }

  try {
    const resend = getResendClient();
    const { data, error } = await resend.domains.list();

    if (error) {
      throw new Error(error.message || 'Failed to list domains');
    }

    return (data.data || []).map(domain => ({
      id: domain.id,
      name: domain.name,
      status: domain.status,
      region: domain.region,
      createdAt: domain.created_at
    }));
  } catch (error) {
    throw new Error(`Failed to list domains: ${error.message}`);
  }
}

/**
 * Delete a domain from Resend
 * @param {string} domainId - The Resend domain ID
 * @returns {Promise<boolean>} True if deleted successfully
 */
async function deleteDomain(domainId) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not configured');
  }

  if (!domainId) {
    throw new Error('Domain ID is required');
  }

  try {
    const resend = getResendClient();
    const { error } = await resend.domains.remove(domainId);

    if (error) {
      throw new Error(error.message || 'Failed to delete domain');
    }

    return true;
  } catch (error) {
    throw new Error(`Failed to delete domain: ${error.message}`);
  }
}

/**
 * Format DNS records for display
 * @param {Array} records - DNS records from Resend
 * @returns {Array} Formatted records for UI display
 */
function formatDnsRecords(records) {
  if (!records || !Array.isArray(records)) {
    return [];
  }

  return records.map(record => ({
    type: record.type,
    name: record.name,
    value: record.value,
    priority: record.priority || null,
    ttl: record.ttl || 'Auto',
    status: record.status // 'pending', 'verified', 'failed'
  }));
}

/**
 * Check if a domain is verified and ready to send emails
 * @param {string} domainId - The Resend domain ID
 * @returns {Promise<boolean>} True if verified
 */
async function isDomainVerified(domainId) {
  try {
    const domain = await getDomain(domainId);
    return domain.status === 'verified';
  } catch (error) {
    return false;
  }
}

module.exports = {
  createDomain,
  getDomain,
  verifyDomain,
  listDomains,
  deleteDomain,
  formatDnsRecords,
  isDomainVerified
};
