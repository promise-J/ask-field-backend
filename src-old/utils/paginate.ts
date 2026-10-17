import {
  Model,
  FilterQuery,
  PopulateOptions,
  HydratedDocument,
} from "mongoose";

interface PaginationOptions {
  page?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
  populate?: string | PopulateOptions | (string | PopulateOptions)[];
}

interface PaginationResult<T> {
  data: HydratedDocument<T>[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

const paginate = async <T>(
  model: Model<T>,
  query: FilterQuery<T> = {},
  options: PaginationOptions = {}
): Promise<PaginationResult<T>> => {
  let {
    page = 1,
    limit = 10,
    sort = { createdAt: -1 },
    populate = "",
  } = options;

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    model
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate(populate as any),
    model.countDocuments(query),
  ]);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

export default paginate;