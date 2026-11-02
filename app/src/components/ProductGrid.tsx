import type { Product } from "../data/products.ts";

export function ProductGrid({ products }: { products: Product[] }) {
  if (products.length === 0) {
    return <div className="empty-state">No products match the current filters.</div>;
  }

  return (
    <div className="product-grid">
      {products.map((p) => (
        <div key={p.id} className="card">
          <div className="card-name">{p.name}</div>
          <div className="card-category">
            {p.category.charAt(0).toUpperCase() + p.category.slice(1)}
          </div>
          <div className="card-price">${p.price.toFixed(2)}</div>
          <div className="card-rating">
            {"★".repeat(Math.round(p.rating))}
            {"☆".repeat(5 - Math.round(p.rating))}{" "}
            <span>{p.rating.toFixed(1)}</span>
          </div>
          <div className={"card-stock " + (p.inStock ? "in-stock" : "out-of-stock")}>
            {p.inStock ? "In Stock" : "Out of Stock"}
          </div>
        </div>
      ))}
    </div>
  );
}
