const AppError = require('../utils/AppError');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
      return next(new AppError(400, 'VALIDATION_ERROR', 'Dados inválidos.', details));
    }
    req[source] = value;
    return next();
  };
}

module.exports = validate;
