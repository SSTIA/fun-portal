import _ from 'lodash';
import path from 'path';
import webpack from 'webpack';
import fs from 'fs-extra';

import ExtractTextPlugin from 'extract-text-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import postcssAutoprefixerPlugin from 'autoprefixer';
import stylusRupturePlugin from 'rupture';

import responsiveCutoff from './ui/responsive.inc.js';

const extractProjectCSS = new ExtractTextPlugin('main.css', { allChunks: true });
const extractVendorCSS = new ExtractTextPlugin('vendors.css', { allChunks: true });

function root(fn) {
  return path.resolve(__dirname, fn);
}

function vjResponsivePlugin() {
  return style => {
    style.define('vjResponsiveCutoff', responsiveCutoff, true);
  };
}

module.exports = {
  context: root('ui'),
  watchOptions: {
    aggregateTimeout: 500,
  },
  entry: {
    main: './Entry.js',
  },
  output: {
    path: root('.uibuild'),
    filename: '[name].js',
    chunkFilename: '[name].chunk.js',
  },
  resolve: {
    modulesDirectories: [root('node_modules'), root('ui')],
    extensions: ['.js', ''],
  },
  module: {
    preLoaders: [
      {
        test: /\.js$/,
        loader: 'eslint',
        exclude: /node_modules\//,
      }
    ],
    loaders: [
      {
        // fonts
        test: /\.(svg|ttf|eot|woff|woff2)/,
        loader: 'file',
        query: {
          name: '[path][name].[ext]?[sha512:hash:base62:7]',
        },
      },
      {
        // images
        test: /\.(png|jpg)/,
        loader: 'url',
        query: {
          limit: 4024,
          name: '[path][name].[ext]?[sha512:hash:base62:7]',
        }
      },
      {
        // ES2015 scripts
        test: /\.js$/,
        exclude: /node_modules\//,
        loader: 'babel',
        query: {
          'presets': ['es2015', 'stage-0'],
          'plugins': ['lodash', 'transform-runtime'],
        },
      },
      {
        // project stylus stylesheets
        test: /\.styl$/,
        loader: extractProjectCSS.extract(['css', 'postcss', 'stylus?resolve url']),
      },
      {
        // vendors stylesheets
        test: /\.css$/,
        include: /node_modules\//,
        loader: extractVendorCSS.extract(['css']),
      },
      {
        // project stylesheets
        test: /\.css$/,
        exclude: /node_modules\//,
        loader: extractProjectCSS.extract(['css', 'postcss']),
      },
    ],
  },
  plugins: [

    new webpack.ProvidePlugin({
      $: 'jquery',
      jQuery: 'jquery',
      'window.jQuery': 'jquery',
    }),

    // don't include locale files in momentjs
    new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),

    // extract stylesheets into a standalone file
    extractVendorCSS,
    extractProjectCSS,

    // extract 3rd-party JavaScript libraries into a standalone file
    new webpack.optimize.CommonsChunkPlugin({
      name: 'vendors',
      filename: 'vendors.js',
      minChunks: (module, count) => (
        module.resource
        && module.resource.indexOf(root('ui/')) === -1
        && module.resource.match(/\.js$/)
      ),
    }),

    // copy static assets
    new CopyWebpackPlugin([{ from: root('ui/static') }]),

  ],
  postcss: () => [postcssAutoprefixerPlugin],
  stylus: {
    use: [
      vjResponsivePlugin(),
      stylusRupturePlugin(),
    ],
    import: [
      '~common/common.inc.styl',
    ]
  },
  eslint: {
    configFile: root('.eslintrc.yml'),
  },
};
