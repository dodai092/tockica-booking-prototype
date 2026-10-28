// Bike map: two columns of 10, aisle after the fifth row. Right column is bikes 1 to 10, left is 11 to 20,
// both counted from the bottom. Rows 1 to 5 are the top block, row 6 is the aisle, rows 7 to 11 the bottom block.
export function bikePosition(bikeNo) {
  const fromBottom = (bikeNo - 1) % 10;
  return {
    column: bikeNo <= 10 ? 2 : 1,
    row: fromBottom < 5 ? 11 - fromBottom : 10 - fromBottom,
  };
}
