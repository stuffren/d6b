export function deployPresets(envName = 'development') {
  const presets = {
    development: { BASE_PATH: '/', SITE_BASE_URL: 'http://localhost:5173' },
    preview: { BASE_PATH: '/', SITE_BASE_URL: 'http://localhost:4173' },
    'gh-pages': { BASE_PATH: '/d6b/', SITE_BASE_URL: 'https://example.github.io/d6b' },
    'custom-domain': { BASE_PATH: '/', SITE_BASE_URL: 'https://d6b.example.com' }
  };

  const repo = process.env.GITHUB_REPOSITORY;
  if (envName === 'gh-pages' && repo && repo.includes('/')) {
    const [owner, name] = repo.split('/');
    presets['gh-pages'] = {
      BASE_PATH: `/${name}/`,
      SITE_BASE_URL: `https://${owner.toLowerCase()}.github.io/${name}`
    };
  }

  return presets;
}