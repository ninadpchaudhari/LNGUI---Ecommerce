/**
 * The product catalog the application logic A ranges over.
 *
 * Lives in `shared/` rather than `src/` so that Apply and A sit beside each
 * other in `transition.ts`, and so the server can compute D without importing
 * from the client bundle.
 *
 * Categories are typed from the generated control surface, so a category that
 * is not in Dom(category) is a compile error.
 */
import { CATEGORY_VALUES } from "./surface.generated.ts";

export type Category = (typeof CATEGORY_VALUES)[number];

export interface Product {
  id: number;
  name: string;
  category: Category;
  price: number;
  rating: number;
  inStock: boolean;
}

export const products: Product[] = [
  // Electronics (4)
  { id: 1,  name: "Wireless Headphones",   category: "electronics", price: 79.99,  rating: 4.5, inStock: true  },
  { id: 2,  name: "Bluetooth Speaker",     category: "electronics", price: 49.99,  rating: 4.0, inStock: true  },
  { id: 3,  name: "USB-C Hub",             category: "electronics", price: 34.99,  rating: 3.5, inStock: false },
  { id: 4,  name: "Mechanical Keyboard",   category: "electronics", price: 149.99, rating: 4.5, inStock: true  },
  // Books (4)
  { id: 5,  name: "The Great Gatsby",      category: "books",       price: 12.99,  rating: 4.0, inStock: true  },
  { id: 6,  name: "Clean Code",            category: "books",       price: 39.99,  rating: 4.5, inStock: true  },
  { id: 7,  name: "Design Patterns",       category: "books",       price: 44.99,  rating: 4.0, inStock: false },
  { id: 8,  name: "Dune",                  category: "books",       price: 15.99,  rating: 5.0, inStock: true  },
  // Clothing (4)
  { id: 9,  name: "Running Shoes",         category: "clothing",    price: 89.99,  rating: 4.0, inStock: true  },
  { id: 10, name: "Winter Jacket",         category: "clothing",    price: 199.99, rating: 4.5, inStock: true  },
  { id: 11, name: "Cotton T-Shirt",        category: "clothing",    price: 19.99,  rating: 3.5, inStock: true  },
  { id: 12, name: "Denim Jeans",           category: "clothing",    price: 59.99,  rating: 4.0, inStock: false },
  // Home (4)
  { id: 13, name: "Ceramic Vase",          category: "home",        price: 34.99,  rating: 4.0, inStock: true  },
  { id: 14, name: "Scented Candle Set",    category: "home",        price: 24.99,  rating: 4.5, inStock: true  },
  { id: 15, name: "Throw Blanket",         category: "home",        price: 45.99,  rating: 4.5, inStock: true  },
  { id: 16, name: "Table Lamp",            category: "home",        price: 64.99,  rating: 3.0, inStock: false },
  // Sports (4)
  { id: 17, name: "Yoga Mat",              category: "sports",      price: 29.99,  rating: 4.0, inStock: true  },
  { id: 18, name: "Resistance Bands Set",  category: "sports",      price: 19.99,  rating: 3.5, inStock: true  },
  { id: 19, name: "Water Bottle",          category: "sports",      price: 14.99,  rating: 4.5, inStock: true  },
  { id: 20, name: "Camping Tent",          category: "sports",      price: 249.99, rating: 4.0, inStock: false },
];

export const TOTAL_PRODUCTS = products.length;
