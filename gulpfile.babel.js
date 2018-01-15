import gulp from 'gulp';
import svgmin from 'gulp-svgmin';
import iconfont from 'gulp-iconfont';
import nunjucks from 'gulp-nunjucks';
import sourcemaps from 'gulp-sourcemaps';
import nodemon from 'gulp-nodemon';
import plumber from 'gulp-plumber';
import babel from 'gulp-babel';
import eslint from 'gulp-eslint';
import Cache from 'gulp-file-cache';
import del from 'del';

const cache = new Cache();

gulp.task('clean:server', () => {
  return del(['.dist/**', '.gulp-cache']);
});

gulp.task('server', () => {
  return gulp.src('./src/**/*.js')
    .pipe(plumber())
    .pipe(sourcemaps.init())
    .pipe(cache.filter())
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(babel())
    .pipe(cache.cache())
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest('./.dist'));
});

gulp.task('server:develop', gulp.series('server', () => {
  nodemon({
    script: '.dist/server.js',
    watch: ['.'],
    ext: 'js yaml',
    ignore: ['node_modules/', 'ui/', '.uibuild/', '.dist/'],
    tasks: ['server'],
  });
}));

const iconTimestamp = ~~(Date.now() / 1000);

gulp.task('fe:iconfont', () => {
  return gulp
    .src('ui/misc/icons/*.svg')
    .pipe(svgmin())
    .pipe(gulp.dest('ui/misc/icons'))
    .pipe(iconfont({
      fontHeight: 1000,
      prependUnicode: false,
      descent: 6.25 / 100 * 1000,
      fontName: 'vj4icon',
      formats: ['svg', 'ttf', 'eot', 'woff', 'woff2'],
      timestamp: iconTimestamp,
    }))
    .on('glyphs', (glyphs, options) => {
      gulp
        .src(`ui/misc/icons/template/*.styl`)
        .pipe(nunjucks.compile({ glyphs, options }))
        .pipe(gulp.dest('ui/misc/.iconfont'));
    })
    .pipe(gulp.dest('ui/misc/.iconfont'));
});

gulp.task('default', gulp.series('server:develop'));
