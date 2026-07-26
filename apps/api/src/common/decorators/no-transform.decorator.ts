import { SetMetadata } from '@nestjs/common';

export const NO_TRANSFORM_KEY = 'no-transform';

export const NoTransform = () => SetMetadata(NO_TRANSFORM_KEY, true);
