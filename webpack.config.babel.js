import _ from 'lodash';
import path from 'path';
import webpack from 'webpack';
import fs from 'fs-extra';

import ExtractTextPlugin from 'extract-text-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import postcssAutoprefixerPlugin from 'autoprefixer';
import stylusRupturePlugin from 'rupture';
import HappyPack from 'happypack';

import responsiveCutoff from './ui/responsive.inc.js';

const extractProjectCSS = new ExtractTextPlugin('main.css', {allChunks: true});
const extractVendorCSS = new ExtractTextPlugin('vendors.css',
  {allChunks: true});

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
    modules: [
      root('node_modules'),
      root('ui'),
    ],
    extensions: ['.js'],
  },
  module: {
    rules: [
      {
        enforce: 'pre',
        test: /\.js$/,
        exclude: /node_modules\//,
        use: {
          loader: 'eslint-loader',
          options: {
            configFile: root('.eslintrc.yml'),
          },
        },
      },
      {
        // fonts
        test: /\.(svg|ttf|eot|woff|woff2)/,
        use: {
          loader: 'file-loader',
          options: {
            name: '[path][name].[ext]?[sha512:hash:base62:7]',
          },
        },
      },
      {
        // images
        test: /\.(png|jpg)/,
        use: {
          loader: 'url-loader',
          options: {
            limit: 4024,
            name: '[path][name].[ext]?[sha512:hash:base62:7]',
          },
        },
      },
      {
        // babel
        test: /\.js$/,
        exclude: /node_modules\//,
        use: 'happypack/loader',
      },
      {
        // project stylus stylesheets
        test: /\.styl$/,
        use: extractProjectCSS.extract(
          [
            'css-loader',
            'postcss-loader',
            {
              loader: 'stylus-loader',
              options: {
                'resolve url': true,
                use: [
                  vjResponsivePlugin(),
                  stylusRupturePlugin(),
                ],
                import: [
                  '~common/common.inc.styl',
                ],
              },
            },
          ]),
      },
      {
        // vendors stylesheets
        test: /\.css$/,
        include: /node_modules\//,
        use: extractVendorCSS.extract(['css-loader']),
      },
      {
        // project stylesheets
        test: /\.css$/,
        exclude: /node_modules\//,
        use: extractProjectCSS.extract(['css-loader', 'postcss-loader']),
      },
    ],
  },
  plugins: [
    new HappyPack({
      loaders: [
        {
          loader: 'babel-loader',
          options: {
            'presets': ['env', 'stage-0'],
            'plugins': ['lodash', 'transform-runtime'],
          },
        },
      ],
      threads: 4,
    }),

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
    new CopyWebpackPlugin([{from: root('ui/static')}]),
  ],
};
