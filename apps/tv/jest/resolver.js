// Jest resolver: workspace packages are ESM "NodeNext" TypeScript and import siblings as "./x.js".
// Try the default resolution first; if a relative ".js" import from inside ../../packages fails,
// retry it as ".ts". Everything else is untouched.
module.exports = (request, options) => {
  try {
    return options.defaultResolver(request, options);
  } catch (error) {
    if (/^\.{1,2}\/.*\.js$/.test(request) && /[\\/]packages[\\/]/.test(options.basedir)) {
      return options.defaultResolver(request.replace(/\.js$/, '.ts'), options);
    }
    throw error;
  }
};
