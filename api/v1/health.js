import { getSupabaseClient } from '../../lib/supabase.js';

/**
 * Health check endpoint to verify API and database connectivity.
 * Useful for clients to verify the API is accessible before making requests.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseResult = getSupabaseClient();
  
  // Check if Supabase credentials are configured
  if (supabaseResult.error) {
    return res.status(503).json({
      status: 'unhealthy',
      message: 'Database credentials not configured',
      error: supabaseResult.error.message
    });
  }

  try {
    // Attempt a simple database query to verify connectivity
    const { data, error } = await supabaseResult.client
      .from('ass_tracks')
      .select('count')
      .limit(1);

    if (error) {
      return res.status(503).json({
        status: 'unhealthy',
        message: 'Database connection failed',
        error: error.message
      });
    }

    return res.status(200).json({
      status: 'healthy',
      message: 'API is operational',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
        supabase: 'connected'
      }
    });
  } catch (err) {
    return res.status(503).json({
      status: 'unhealthy',
      message: 'Health check failed',
      error: err?.message || 'Unexpected error'
    });
  }
}
